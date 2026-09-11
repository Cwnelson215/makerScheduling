import type { SearchState } from '../state'
import type { DayPattern, ProblemContext } from '../types'

/**
 * A scoring rule. **Rules only ever subtract.**
 *
 * Every schedule starts at {@link MAX_SCORE} and each rule removes points, so a node's score
 * is an upper bound on every schedule beneath it — which is precisely what makes
 * "prune when score < threshold" provably safe.
 *
 * A rule is *local* if its penalty is decided by one (employee, day, pattern) in isolation
 * (`patternPenalty`). Local penalties are precomputed into a lookup table and tracked
 * incrementally, so they cost nothing during the search and are exactly tight.
 *
 * A rule is *global* if it needs to see across slots (`lowerBound`). Its bound must satisfy:
 *
 *   1. **Non-negative** — `lowerBound(state) >= 0`.
 *   2. **Monotone** — assigning another slot never *lowers* the bound.
 *   3. **Exact when complete** — `lowerBound(completeState) === final(assignment)`.
 *
 * Violating (2) makes the solver silently discard valid schedules. That is the single most
 * dangerous bug class in this project, so `tests/rules.monotonicity.test.ts` asserts all
 * three properties for every rule rather than trusting review.
 */
export interface Rule {
  id: string
  /** Human-readable name for reports. */
  label: string
  /** Points removed per unit of penalty. Admin-configurable. */
  weight: number
  /**
   * Penalty units attributable to a single (employee, day, pattern) alone.
   * Present only on local rules.
   */
  patternPenalty?: (
    pattern: DayPattern,
    employeeIndex: number,
    day: number,
    ctx: ProblemContext,
  ) => number
  /**
   * Lower bound on this rule's FINAL penalty units, given a partial assignment.
   * Present only on global rules. Must be non-negative, monotone, and exact when complete.
   */
  lowerBound?: (state: SearchState, ctx: ProblemContext) => number
  /** Exact penalty units for a fully-assigned schedule. */
  final: (patternIndices: Int32Array, ctx: ProblemContext) => number
}

export interface CompiledRuleSet {
  rules: Rule[]
  /** Rules with a `lowerBound`; evaluated at every node. */
  globalRules: Rule[]
  /** Rules whose penalty is folded into {@link localPenaltyTable}. */
  localRules: Rule[]
  /** `localPenaltyTable[slotId][patternIndex]` — weighted sum across all local rules. */
  localPenaltyTable: Float64Array[]
  /** Keep schedules scoring at or above this. Branches that cannot reach it are abandoned. */
  threshold: number
}
