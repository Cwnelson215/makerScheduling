import { describe, expect, it } from 'vitest'
import { buildProblemContext } from '../src/core/patterns'
import { defaultRules, nonPreferredHourRule } from '../src/core/rules/builtins'
import { compileRules } from '../src/core/rules/registry'
import type { Rule } from '../src/core/rules/types'
import { applyPattern, createState, isComplete, undoPattern } from '../src/core/state'
import { buildSlotOrder } from '../src/core/search/ordering'
import { solve } from '../src/core/search/solver'
import { DAYS_PER_WEEK } from '../src/core/types'
import { loadFixture, makeRng, ruleLowerBound } from './helpers'

/**
 * The contract every rule must satisfy for pruning to be safe:
 *
 *   1. non-negative        — a bound can never hand points back
 *   2. monotone            — deciding one more slot never *lowers* the bound
 *   3. exact when complete — `lowerBound` equals `final` once nothing is left to assign
 *
 * (2) is the load-bearing one. If a rule's bound can dip as the search descends, then a node's
 * score is no longer a ceiling for its subtree, and "prune when score < threshold" starts
 * discarding schedules that would have qualified — silently, with no error and no crash. The
 * only symptom is a result set that is quietly missing entries.
 *
 * These properties are checked per rule rather than on the aggregate score, so a failure names
 * the offending rule directly.
 */
describe('rule lower bounds are monotone', () => {
  const fixtures = ['small-cafe.json', 'medium-shop.json']

  for (const fixture of fixtures) {
    describe(fixture, () => {
      const { employees, config } = loadFixture(fixture)
      const ctx = buildProblemContext(employees, config)
      const rules = defaultRules()
      const ruleSet = compileRules(rules, ctx, 0)
      const order = buildSlotOrder(ctx)

      /** Walks a random root-to-leaf path, asserting the contract at every step. */
      const walk = (rule: Rule, seed: number): void => {
        const rng = makeRng(seed)
        const state = createState(ctx, order, ruleSet.localPenaltyTable)
        let previous = ruleLowerBound(rule, state, ctx)
        expect(previous).toBeGreaterThanOrEqual(0)

        while (!isComplete(state)) {
          const slot = order[state.depth]
          const employee = Math.floor(slot / DAYS_PER_WEEK)
          const maxWeekly = ctx.employees[employee].maxWeeklyHours
          const patterns = ctx.patterns[slot]

          // Only patterns that keep the hard weekly cap intact — an over-cap state is not one
          // the solver can ever be in, so bounds are not required to behave there.
          const legal: number[] = []
          for (let p = 0; p < patterns.length; p++) {
            if (state.employeeHours[employee] + patterns[p].hours <= maxWeekly) legal.push(p)
          }
          expect(legal.length).toBeGreaterThan(0) // index 0 is always the empty pattern

          applyPattern(state, legal[Math.floor(rng() * legal.length)])

          const current = ruleLowerBound(rule, state, ctx)
          expect(current).toBeGreaterThanOrEqual(0)
          if (current < previous) {
            throw new Error(
              `Rule "${rule.id}" bound DECREASED from ${previous} to ${current} at depth ` +
                `${state.depth} (seed ${seed}). Pruning with this rule is unsound.`,
            )
          }
          previous = current
        }

        expect(ruleLowerBound(rule, state, ctx)).toBe(rule.final(state.patternAt, ctx))

        while (state.depth > 0) undoPattern(state)
      }

      for (const rule of rules) {
        it(`${rule.id}: non-negative, monotone, and exact at completion`, () => {
          for (let seed = 1; seed <= 40; seed++) walk(rule, seed)
        })
      }

      it('the aggregate score bound is exact at completion', () => {
        const rng = makeRng(99)
        const state = createState(ctx, order, ruleSet.localPenaltyTable)
        while (!isComplete(state)) {
          const slot = order[state.depth]
          const employee = Math.floor(slot / DAYS_PER_WEEK)
          const maxWeekly = ctx.employees[employee].maxWeeklyHours
          const patterns = ctx.patterns[slot]
          const legal: number[] = []
          for (let p = 0; p < patterns.length; p++) {
            if (state.employeeHours[employee] + patterns[p].hours <= maxWeekly) legal.push(p)
          }
          applyPattern(state, legal[Math.floor(rng() * legal.length)])
        }

        let summed = 0
        for (const rule of rules) summed += rule.weight * ruleLowerBound(rule, state, ctx)
        let exact = 0
        for (const rule of rules) exact += rule.weight * rule.final(state.patternAt, ctx)
        expect(summed).toBeCloseTo(exact, 9)
      })
    })
  }
})

/**
 * Negative control: proves the checks above can actually fail.
 *
 * A property test that never fails is worthless, and "all rules are monotone" is exactly the
 * shape of assertion that can pass vacuously. These plant rules that break the contract in
 * each of the three ways and require the harness to catch them — and, more importantly,
 * require the *solver* to return a wrong answer when the contract is broken, which is what
 * makes the contract worth enforcing in the first place.
 */
describe('the monotonicity harness detects broken rules', () => {
  const { employees, config } = loadFixture('small-cafe.json')
  const ctx = buildProblemContext(employees, config)
  const ruleSet = compileRules(defaultRules(), ctx, 0)
  const order = buildSlotOrder(ctx)

  /** Bound falls as the search descends — the unsound case that silently loses schedules. */
  const decreasingRule: Rule = {
    id: 'broken-decreasing',
    label: 'deliberately non-monotone',
    weight: 1,
    lowerBound: (state) => state.employeeRemainingCapacity[0],
    final: () => 0,
  }

  /** Monotone, but disagrees with `final` at the leaf. */
  const inexactRule: Rule = {
    id: 'broken-inexact',
    label: 'deliberately inexact at completion',
    weight: 1,
    lowerBound: (state) => state.depth,
    final: () => 0,
  }

  const boundsAlongRandomWalk = (rule: Rule): number[] => {
    const rng = makeRng(3)
    const state = createState(ctx, order, ruleSet.localPenaltyTable)
    const seen: number[] = [ruleLowerBound(rule, state, ctx)]
    while (!isComplete(state)) {
      const patterns = ctx.patterns[order[state.depth]]
      applyPattern(state, Math.floor(rng() * patterns.length))
      seen.push(ruleLowerBound(rule, state, ctx))
    }
    return seen
  }

  it('catches a bound that decreases', () => {
    const seen = boundsAlongRandomWalk(decreasingRule)
    const dipped = seen.some((v, i) => i > 0 && v < seen[i - 1])
    expect(dipped).toBe(true)
  })

  it('catches a bound that disagrees with final at the leaf', () => {
    const seen = boundsAlongRandomWalk(inexactRule)
    expect(seen[seen.length - 1]).not.toBe(0)
  })

  it('a non-monotone rule really does make the solver lose valid schedules', () => {
    const honest = [nonPreferredHourRule(1)]
    const poisoned = [nonPreferredHourRule(1), { ...decreasingRule, weight: 1 }]
    const shared = { maxResults: 1_000_000, maxNodes: Infinity, maxMillis: Infinity }

    // The broken rule contributes 0 at every leaf, so it cannot change which schedules
    // qualify — only which branches get cut on the way down. Any difference in the result
    // set is therefore pruning error, not a scoring difference.
    const clean = solve(employees, config, { ...shared, rules: honest, threshold: 90 })
    const broken = solve(employees, config, { ...shared, rules: poisoned, threshold: 90 })

    expect(clean.report.complete).toBe(true)
    expect(broken.report.complete).toBe(true)
    expect(clean.schedules.length).toBeGreaterThan(0)
    expect(broken.schedules.length).toBeLessThan(clean.schedules.length)
  })
})

/**
 * `undoPattern` must restore the state byte-for-byte. Every prune rewinds, so a leak in the
 * inverse would corrupt sibling branches — and would look exactly like a bad bound.
 */
describe('state apply/undo is a perfect inverse', () => {
  const { employees, config } = loadFixture('medium-shop.json')
  const ctx = buildProblemContext(employees, config)
  const ruleSet = compileRules(defaultRules(), ctx, 0)
  const order = buildSlotOrder(ctx)

  const snapshot = (s: ReturnType<typeof createState>) =>
    JSON.stringify({
      depth: s.depth,
      patternAt: [...s.patternAt],
      coverage: [...s.coverage],
      slack: [...s.slack],
      negativeSlack: s.negativeSlack,
      employeeHours: [...s.employeeHours],
      employeeRemainingCapacity: [...s.employeeRemainingCapacity],
      employeeDecidedDays: [...s.employeeDecidedDays],
      localPenalty: s.localPenalty,
      overCoverageHours: s.overCoverageHours,
    })

  it('returns to the exact prior state after any single move', () => {
    const rng = makeRng(7)
    const state = createState(ctx, order, ruleSet.localPenaltyTable)

    while (!isComplete(state)) {
      const before = snapshot(state)
      const slot = order[state.depth]
      const patterns = ctx.patterns[slot]

      // Probe several alternatives from this node, rewinding each time.
      for (let trial = 0; trial < 5; trial++) {
        const pick = Math.floor(rng() * patterns.length)
        applyPattern(state, pick)
        undoPattern(state)
        expect(snapshot(state)).toBe(before)
      }

      applyPattern(state, Math.floor(rng() * patterns.length))
    }

    while (state.depth > 0) undoPattern(state)
    expect(snapshot(state)).toBe(snapshot(createState(ctx, order, ruleSet.localPenaltyTable)))
  })
})
