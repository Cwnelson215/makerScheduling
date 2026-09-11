import type { CompiledRuleSet } from '../rules/types'
import { DAYS_PER_WEEK, type ProblemContext } from '../types'

export type SlotOrdering = 'day-major' | 'employee-major'

/**
 * Decision order for the (employee, day) slots.
 *
 * **`day-major` (default)** finishes one whole day across all employees before starting the
 * next. Coverage is the hardest constraint in a realistic problem, and it only becomes
 * checkable once a day is fully staffed — so deciding day by day surfaces "this day cannot be
 * covered" after a handful of assignments instead of after the entire week is committed.
 *
 * It also keeps the per-employee bounds useful: after `k` days every employee has days
 * `0..k-1` decided, so `consecutiveDays` and `clopen` accumulate real penalties as the search
 * descends rather than sitting at zero until the leaves.
 *
 * **`employee-major`** finishes one employee's whole week at a time. It makes each employee's
 * weekly-hours bounds exact sooner, but it commits people to a full week before knowing
 * whether coverage is even reachable, which thrashes badly on tight rosters.
 *
 * Within each group the most constrained slots (fewest legal patterns) come first, so dead
 * subtrees are found near the root.
 *
 * Ordering affects only *speed*. Any order enumerates the same set of complete schedules,
 * which is why the brute-force equivalence test is order-independent.
 */
export function buildSlotOrder(
  ctx: ProblemContext,
  ordering: SlotOrdering = 'day-major',
): Int32Array {
  const employeeCount = ctx.employees.length
  const order = new Int32Array(employeeCount * DAYS_PER_WEEK)
  const optionsFor = (slot: number) => ctx.patterns[slot].length
  let i = 0

  if (ordering === 'day-major') {
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const slots = Array.from({ length: employeeCount }, (_, e) => e * DAYS_PER_WEEK + day)
      slots.sort((a, b) => optionsFor(a) - optionsFor(b) || a - b)
      for (const slot of slots) order[i++] = slot
    }
    return order
  }

  const employees = Array.from({ length: employeeCount }, (_, e) => {
    let options = 0
    for (let day = 0; day < DAYS_PER_WEEK; day++) options += optionsFor(e * DAYS_PER_WEEK + day)
    return { employee: e, options }
  })
  employees.sort((a, b) => a.options - b.options || a.employee - b.employee)
  for (const { employee } of employees) {
    for (let day = 0; day < DAYS_PER_WEEK; day++) order[i++] = employee * DAYS_PER_WEEK + day
  }
  return order
}

/**
 * Per-slot tie-break order: cheapest local penalty first, then *fewest* hours.
 *
 * Fewest, not most. The solver ranks candidates primarily by how much unmet coverage they
 * fill (see `rankCandidates`), so this only decides between patterns that are equally useful
 * for coverage — and among those, the shorter one is strictly better: it costs less
 * over-coverage and pushes fewer people past their target hours. Preferring longer shifts here
 * makes the search dive straight into rosters where everyone works their weekly maximum.
 *
 * This is a static ordering computed once. It never changes which schedules exist, only the
 * order they are reached in.
 */
export function buildValueOrder(ctx: ProblemContext, ruleSet: CompiledRuleSet): Int32Array[] {
  const orders: Int32Array[] = new Array(ctx.patterns.length)
  for (let slot = 0; slot < ctx.patterns.length; slot++) {
    const patterns = ctx.patterns[slot]
    const penalties = ruleSet.localPenaltyTable[slot]
    const indices = Array.from({ length: patterns.length }, (_, i) => i)
    indices.sort(
      (a, b) => penalties[a] - penalties[b] || patterns[a].hours - patterns[b].hours || a - b,
    )
    orders[slot] = Int32Array.from(indices)
  }
  return orders
}
