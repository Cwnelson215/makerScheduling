import { describe, expect, it } from 'vitest'
import { buildProblemContext } from '../src/core/patterns'
import {
  clopenRule,
  consecutiveDaysRule,
  defaultRules,
  evenDistributionRule,
  nonPreferredHourRule,
  overCoverageRule,
  overTargetHoursRule,
  shortShiftRule,
  splitShiftRule,
  underTargetHoursRule,
} from '../src/core/rules/builtins'
import { compileRules } from '../src/core/rules/registry'
import type { Rule } from '../src/core/rules/types'
import { solve } from '../src/core/search/solver'
import { weekDayIndex } from '../src/core/calendar'
import { DAYS_PER_WEEK, HOURS_PER_DAY, type ProblemContext } from '../src/core/types'
import {
  bruteForce,
  FIXTURE_WEEK,
  loadFixture,
  loadPinnedSmallCafe,
  searchSpaceSize,
  SMALL_CAFE_EXCEPTIONS,
} from './helpers'

/**
 * The proof that pruning is sound.
 *
 * Branch-and-bound is only correct if the branches it throws away could never have contained
 * a qualifying schedule. Reviewing the bounds by eye cannot establish that. Instead, on a
 * fixture small enough to enumerate completely, we compute the answer twice — once by naive
 * exhaustion with no pruning at all, once by the real solver — and require the two sets to be
 * *identical*, not merely similar.
 *
 * If any rule's lower bound is ever too aggressive, the solver's set comes back smaller and
 * this test names the exact schedules that were wrongly discarded.
 */
describe('branch-and-bound matches exhaustive enumeration', () => {
  const { employees, config } = loadFixture('small-cafe.json')
  const ctx = buildProblemContext(employees, config)

  it('uses a fixture small enough to genuinely enumerate', () => {
    // Guards the test's own premise: if someone widens the fixture, this fails loudly rather
    // than silently turning brute force into a multi-hour run.
    expect(searchSpaceSize(ctx)).toBeLessThan(200_000)
  })

  const scenarios: { name: string; rules: () => Rule[]; thresholds: number[] }[] = [
    {
      name: 'default weights',
      rules: defaultRules,
      thresholds: [-Infinity, 0, 50, 70, 76, 80, 81, 1000],
    },
    {
      name: 'coverage cost only',
      rules: () => [overCoverageRule(4)],
      thresholds: [-Infinity, 60, 88, 100],
    },
    {
      name: 'preference-driven',
      rules: () => [nonPreferredHourRule(7), underTargetHoursRule(3), evenDistributionRule(2)],
      thresholds: [-Infinity, 40, 75, 95],
    },
    {
      name: 'shape-driven',
      rules: () => [splitShiftRule(9), shortShiftRule(6, 4), clopenRule(11)],
      thresholds: [-Infinity, 50, 88, 100],
    },
    {
      name: 'every rule, unusual weights',
      rules: () => [
        nonPreferredHourRule(3),
        splitShiftRule(1),
        shortShiftRule(5, 3),
        overCoverageRule(2),
        underTargetHoursRule(6),
        overTargetHoursRule(1),
        consecutiveDaysRule(2),
        clopenRule(4),
        evenDistributionRule(3),
      ],
      thresholds: [-Infinity, 0, 45, 70, 90],
    },
    {
      name: 'all weights zero (every valid schedule qualifies)',
      rules: () => [nonPreferredHourRule(0), overCoverageRule(0), underTargetHoursRule(0)],
      thresholds: [100],
    },
  ]

  for (const scenario of scenarios) {
    for (const threshold of scenario.thresholds) {
      it(`${scenario.name} @ threshold ${threshold}`, () => {
        const rules = scenario.rules()
        const ruleSet = compileRules(rules, ctx, threshold)
        const expected = bruteForce(ctx, ruleSet, threshold)

        const { schedules, report } = solve(employees, config, {
          rules,
          threshold,
          maxResults: 1_000_000,
          maxNodes: Infinity,
          maxMillis: Infinity,
          assertBoundsExact: true,
        })

        expect(report.complete).toBe(true)
        expect(report.schedulesDropped).toBe(0)

        const expectedKeys = new Set(expected.map((h) => h.key))
        const actualKeys = new Set(schedules.map((s) => s.patternIndices.join(',')))

        const missing = [...expectedKeys].filter((k) => !actualKeys.has(k))
        const extra = [...actualKeys].filter((k) => !expectedKeys.has(k))

        // Named separately so a failure says whether pruning was too aggressive (missing) or
        // the solver admitted something invalid (extra).
        expect({ missingCount: missing.length, sample: missing.slice(0, 3) }).toEqual({
          missingCount: 0,
          sample: [],
        })
        expect({ extraCount: extra.length, sample: extra.slice(0, 3) }).toEqual({
          extraCount: 0,
          sample: [],
        })
        expect(schedules.length).toBe(expected.length)
      })
    }
  }

  it('scores agree exactly between the two paths', () => {
    const rules = defaultRules()
    const threshold = 70
    const ruleSet = compileRules(rules, ctx, threshold)
    const expected = new Map(bruteForce(ctx, ruleSet, threshold).map((h) => [h.key, h.score]))

    const { schedules } = solve(employees, config, {
      rules,
      threshold,
      maxResults: 1_000_000,
      maxNodes: Infinity,
      maxMillis: Infinity,
    })

    for (const schedule of schedules) {
      expect(schedule.score).toBe(expected.get(schedule.patternIndices.join(',')))
    }
  })

  it('is unaffected by slot ordering', () => {
    const rules = defaultRules()
    const shared = { rules, threshold: 70, maxResults: 1_000_000, maxNodes: Infinity, maxMillis: Infinity }

    const dayMajor = solve(employees, config, { ...shared, ordering: 'day-major' })
    const employeeMajor = solve(employees, config, { ...shared, ordering: 'employee-major' })

    expect(dayMajor.report.complete).toBe(true)
    expect(employeeMajor.report.complete).toBe(true)

    const keys = (r: typeof dayMajor) =>
      r.schedules.map((s) => s.patternIndices.join(',')).sort()
    expect(keys(dayMajor)).toEqual(keys(employeeMajor))
  })

  it('a higher threshold yields a strict subset', () => {
    const rules = defaultRules()
    const shared = { rules, maxResults: 1_000_000, maxNodes: Infinity, maxMillis: Infinity }

    const loose = solve(employees, config, { ...shared, threshold: 60 })
    const tight = solve(employees, config, { ...shared, threshold: 78 })

    const looseKeys = new Set(loose.schedules.map((s) => s.patternIndices.join(',')))
    for (const schedule of tight.schedules) {
      expect(looseKeys.has(schedule.patternIndices.join(','))).toBe(true)
    }
    expect(tight.schedules.length).toBeLessThan(loose.schedules.length)
  })
})

/**
 * Pins and time off are implemented by narrowing the pattern lists, so the brute force above —
 * which enumerates those same lists — cannot on its own tell whether the narrowing is right.
 * These tests add an independent statement of the constraint: enumerate the *unconstrained*
 * roster and keep only schedules that visibly honour the dated entries.
 */
describe('pins and time off', () => {
  const raw = loadFixture('small-cafe.json')
  const pinned = loadPinnedSmallCafe()
  const rawCtx = buildProblemContext(raw.employees, raw.config)
  const pinnedCtx = buildProblemContext(pinned.employees, pinned.config)

  /** A schedule as its per-slot worked-hour masks — comparable across the two contexts. */
  const maskKey = (key: string, ctx: ProblemContext) =>
    key.split(',').map((index, slot) => ctx.patterns[slot][Number(index)].mask).join(',')

  /** Plain reading of the dated entries: every pinned hour worked, no hour worked in time off. */
  const honoursExceptions = (masks: number[]): boolean =>
    raw.employees.every((employee, e) => {
      const { pins, timeOff } = SMALL_CAFE_EXCEPTIONS[employee.id] ?? { pins: [], timeOff: [] }
      const hoursOf = (entry: { date: string; startHour: number; endHour: number }) => {
        const day = weekDayIndex(FIXTURE_WEEK, entry.date)
        if (day === null) return null
        let mask = 0
        for (let hour = entry.startHour; hour < Math.min(entry.endHour, HOURS_PER_DAY); hour++) mask |= 1 << hour
        return { worked: masks[e * DAYS_PER_WEEK + day], mask }
      }
      return (
        pins.every((entry) => {
          const h = hoursOf(entry)
          return h === null || (h.worked & h.mask) === h.mask
        }) &&
        timeOff.every((entry) => {
          const h = hoursOf(entry)
          return h === null || (h.worked & h.mask) === 0
        })
      )
    })

  it('actually constrains the fixture', () => {
    expect(searchSpaceSize(pinnedCtx)).toBeLessThan(searchSpaceSize(rawCtx))
    // Ana's pinned Monday leaves no day-off option.
    expect(pinnedCtx.patterns[0 * DAYS_PER_WEEK + 0].every((p) => p.hours > 0)).toBe(true)
  })

  for (const threshold of [-Infinity, 0, 60, 75]) {
    it(`narrowed patterns select exactly the schedules that honour the entries @ threshold ${threshold}`, () => {
      const expected = new Map(
        bruteForce(rawCtx, compileRules(defaultRules(), rawCtx, threshold), threshold)
          .map((hit) => [maskKey(hit.key, rawCtx), hit.score] as const)
          .filter(([key]) => honoursExceptions(key.split(',').map(Number))),
      )
      const actual = new Map(
        bruteForce(pinnedCtx, compileRules(defaultRules(), pinnedCtx, threshold), threshold).map(
          (hit) => [maskKey(hit.key, pinnedCtx), hit.score] as const,
        ),
      )
      if (threshold === -Infinity) expect(expected.size).toBeGreaterThan(0)
      expect(actual).toEqual(expected)
    })
  }

  for (const threshold of [-Infinity, 0, 60, 75]) {
    it(`branch-and-bound matches exhaustive enumeration @ threshold ${threshold}`, () => {
      const rules = defaultRules()
      const expected = bruteForce(pinnedCtx, compileRules(rules, pinnedCtx, threshold), threshold)
      const { schedules, report } = solve(pinned.employees, pinned.config, {
        rules,
        threshold,
        maxResults: 1_000_000,
        maxNodes: Infinity,
        maxMillis: Infinity,
        assertBoundsExact: true,
      })
      expect(report.complete).toBe(true)
      expect(schedules.map((s) => s.patternIndices.join(',')).sort()).toEqual(expected.map((h) => h.key).sort())
    })
  }
})
