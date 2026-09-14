import { describe, expect, it } from 'vitest'
import { buildProblemContext } from '../src/core/patterns'
import { formatReport } from '../src/core/report'
import { defaultRules } from '../src/core/rules/builtins'
import { compileRules, scoreBound, scoreComplete } from '../src/core/rules/registry'
import { applyPattern, createState, undoPattern } from '../src/core/state'
import { buildSlotOrder } from '../src/core/search/ordering'
import { calibrate, solve } from '../src/core/search/solver'
import { DAYS_PER_WEEK, HOURS_PER_DAY, WEEK_HOURS, slotIndex } from '../src/core/types'
import { bruteForce, loadFixture, loadPinnedSmallCafe, makeRng } from './helpers'

const THRESHOLD = 70

for (const fixture of [
  { name: 'small-cafe.json', load: () => loadFixture('small-cafe.json'), minHits: 100 },
  { name: 'small-cafe.json with pins and time off', load: loadPinnedSmallCafe, minHits: 1 },
]) describe(`pruning never cuts off a qualifying schedule: ${fixture.name}`, () => {
  const { employees, config } = fixture.load()
  const ctx = buildProblemContext(employees, config)
  const rules = defaultRules()
  const ruleSet = compileRules(rules, ctx, THRESHOLD)
  const order = buildSlotOrder(ctx)

  /**
   * The soundness property stated directly, rather than inferred from matching result sets:
   * walk the solver down the exact path of a known-good schedule and require that no prune
   * condition is ever true along the way. If any were, that schedule would be unreachable.
   */
  it('every prefix of every valid schedule survives all three prunes', () => {
    const hits = bruteForce(ctx, ruleSet, THRESHOLD)
    expect(hits.length).toBeGreaterThanOrEqual(fixture.minHits)

    const state = createState(ctx, order, ruleSet.localPenaltyTable)

    for (const hit of hits) {
      const target = Int32Array.from(hit.key.split(',').map(Number))

      for (let step = 0; step < order.length; step++) {
        const slot = order[step]
        const employee = Math.floor(slot / DAYS_PER_WEEK)
        const pattern = ctx.patterns[slot][target[slot]]

        expect(state.employeeHours[employee] + pattern.hours).toBeLessThanOrEqual(
          ctx.employees[employee].maxWeeklyHours,
        )

        applyPattern(state, target[slot])

        expect(state.negativeSlack).toBe(0)
        expect(scoreBound(state, ruleSet, ctx)).toBeGreaterThanOrEqual(THRESHOLD)
      }

      expect(scoreComplete(state.patternAt, ruleSet, ctx).score).toBe(hit.score)
      while (state.depth > 0) undoPattern(state)
    }
  })

  it('the score bound falls monotonically down any path', () => {
    const rng = makeRng(11)
    const state = createState(ctx, order, ruleSet.localPenaltyTable)
    let previous = scoreBound(state, ruleSet, ctx)

    while (state.depth < order.length) {
      const slot = order[state.depth]
      const employee = Math.floor(slot / DAYS_PER_WEEK)
      const patterns = ctx.patterns[slot]
      const legal: number[] = []
      for (let p = 0; p < patterns.length; p++) {
        if (state.employeeHours[employee] + patterns[p].hours <= ctx.employees[employee].maxWeeklyHours) {
          legal.push(p)
        }
      }
      applyPattern(state, legal[Math.floor(rng() * legal.length)])

      const current = scoreBound(state, ruleSet, ctx)
      expect(current).toBeLessThanOrEqual(previous + 1e-9)
      previous = current
    }
  })
})

describe('coverage slack invariant', () => {
  const { employees, config } = loadFixture('medium-shop.json')
  const ctx = buildProblemContext(employees, config)
  const ruleSet = compileRules(defaultRules(), ctx, 0)
  const order = buildSlotOrder(ctx)

  /**
   * `slack[h]` is maintained incrementally and drives the hard coverage prune, so it must
   * always equal what a from-scratch recount says: current coverage, plus everything the
   * undecided slots could still contribute, minus what the hour requires.
   */
  it('matches a from-scratch recount at every depth', () => {
    const rng = makeRng(23)
    const state = createState(ctx, order, ruleSet.localPenaltyTable)

    const recount = (): Int32Array => {
      const fresh = new Int32Array(WEEK_HOURS)
      for (let slot = 0; slot < ctx.patterns.length; slot++) {
        const day = slot % DAYS_PER_WEEK
        const decided = state.patternAt[slot]
        const mask = decided < 0 ? ctx.coverableMask[slot] : ctx.patterns[slot][decided].mask
        for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
          if (mask & (1 << hour)) fresh[slotIndex(day, hour)]++
        }
      }
      for (let i = 0; i < WEEK_HOURS; i++) fresh[i] -= ctx.config.minCoverage[i]
      return fresh
    }

    while (state.depth < order.length) {
      expect([...state.slack]).toEqual([...recount()])
      let negatives = 0
      for (const value of state.slack) if (value < 0) negatives++
      expect(state.negativeSlack).toBe(negatives)

      const patterns = ctx.patterns[order[state.depth]]
      applyPattern(state, Math.floor(rng() * patterns.length))
    }
    expect([...state.slack]).toEqual([...recount()])
  })
})

describe('budgets and reporting', () => {
  const { employees, config } = loadFixture('medium-shop.json')

  it('reports truncation honestly when the node budget runs out', () => {
    const { report } = solve(employees, config, { threshold: -200, maxNodes: 20_000 })
    expect(report.complete).toBe(false)
    expect(report.stopReason).toBe('nodeBudget')
    expect(report.nodesExplored).toBeLessThanOrEqual(20_000)
  })

  it('reports truncation when the time budget runs out', () => {
    const { report } = solve(employees, config, {
      threshold: -200,
      maxNodes: Infinity,
      maxMillis: 150,
    })
    expect(report.complete).toBe(false)
    expect(report.stopReason).toBe('timeBudget')
  })

  it('honours an abort signal', () => {
    const controller = new AbortController()
    controller.abort()
    const { report } = solve(employees, config, {
      threshold: -200,
      maxNodes: Infinity,
      maxMillis: Infinity,
      signal: controller.signal,
    })
    expect(report.complete).toBe(false)
    expect(report.stopReason).toBe('aborted')
  })

  it('records dropped schedules rather than silently capping', () => {
    const small = loadFixture('small-cafe.json')
    const { schedules, report } = solve(small.employees, small.config, {
      threshold: 70,
      maxResults: 10,
      maxNodes: Infinity,
      maxMillis: Infinity,
    })
    expect(schedules).toHaveLength(10)
    expect(report.complete).toBe(true)
    expect(report.schedulesFound).toBeGreaterThan(10)
    expect(report.schedulesDropped).toBe(report.schedulesFound - 10)
  })
})

describe('incumbent tightening', () => {
  const { employees, config } = loadFixture('small-cafe.json')

  /**
   * `tightenToBest` changes what a completed search proves — the top-K rather than every
   * schedule above the threshold — but it must still find the same *best* schedule, since the
   * floor it raises is only ever set to a score already achieved.
   */
  it('finds the same optimum as the untightened search', () => {
    const shared = { threshold: 0, maxNodes: Infinity, maxMillis: Infinity }
    const full = solve(employees, config, { ...shared, maxResults: 1_000_000 })
    const tightened = solve(employees, config, { ...shared, maxResults: 5, tightenToBest: true })

    expect(full.report.complete).toBe(true)
    expect(tightened.report.complete).toBe(true)
    expect(tightened.schedules[0].score).toBe(full.schedules[0].score)
    expect(tightened.report.nodesExplored).toBeLessThan(full.report.nodesExplored)
  })

  /**
   * A completed tightened search proves less than a completed plain one. Both say "complete",
   * so the distinction has to live in the report, or a top-K result reads as the full set.
   */
  it('distinguishes what a completed search actually proves', () => {
    const shared = { threshold: 0, maxNodes: Infinity, maxMillis: Infinity }
    const full = solve(employees, config, { ...shared, maxResults: 1_000_000 })
    const tightened = solve(employees, config, { ...shared, maxResults: 5, tightenToBest: true })

    expect(full.report.provenScope).toBe('all-above-threshold')
    expect(tightened.report.provenScope).toBe('top-k')

    expect(formatReport(full.report)).toContain('every schedule at or above the threshold')
    expect(formatReport(tightened.report)).toContain('NOT every qualifying schedule')

    // The tightened run discarded qualifying schedules by design, so it must not also claim
    // they were merely lost to the result cap.
    expect(formatReport(tightened.report)).not.toContain('raise maxResults')
  })

  it('calibration reports the true optimum when the search completes', () => {
    const { bestScore, suggestedThreshold, report } = calibrate(employees, config, {
      maxNodes: Infinity,
      maxMillis: Infinity,
    })
    const full = solve(employees, config, {
      threshold: -Infinity,
      maxResults: 1_000_000,
      maxNodes: Infinity,
      maxMillis: Infinity,
    })

    expect(report.complete).toBe(true)
    expect(bestScore).toBe(full.schedules[0].score)
    expect(suggestedThreshold).toBeLessThan(bestScore!)
  })
})
