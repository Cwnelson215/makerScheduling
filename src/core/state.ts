import {
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  WEEK_HOURS,
  slotIndex,
  type ProblemContext,
} from './types'

/**
 * Mutable search state, advanced by {@link applyPattern} and rewound by {@link undoPattern}.
 *
 * Every field is maintained incrementally: a node costs O(hours in a day), not O(problem size).
 * `undoPattern` must restore the state exactly, so each field updated on apply has a mirrored
 * inverse. The brute-force equivalence test in `tests/solver.exhaustive.test.ts` is what
 * actually holds this honest.
 */
export interface SearchState {
  readonly ctx: ProblemContext
  /** Slot ids (`employeeIndex * 7 + day`) in the order the search decides them. */
  readonly order: Int32Array
  /** Weighted local-rule penalty per `[slotId][patternIndex]`, precomputed by the rule registry. */
  readonly localPenaltyTable: Float64Array[]

  /** How many entries of `order` are currently decided. */
  depth: number
  /** Slot id → chosen pattern index, or -1 while undecided. */
  readonly patternAt: Int32Array

  /** Current headcount per week-hour. */
  readonly coverage: Int32Array
  /**
   * `coverage[h] + (contributors still undecided that could cover h) - minCoverage[h]`.
   * Negative anywhere means this branch can no longer meet coverage — a hard, always-valid prune.
   */
  readonly slack: Int32Array
  /** Number of hours whose slack has gone negative. Zero means coverage is still reachable. */
  negativeSlack: number

  readonly employeeHours: Int32Array
  /** Hours an employee could still gain from their undecided days (ignoring the weekly cap). */
  readonly employeeRemainingCapacity: Int32Array
  readonly employeeDecidedDays: Int32Array

  /** Running weighted total of all local-rule penalties. Only ever grows. */
  localPenalty: number
  /** Running count of staffed-hours above the required minimum. Only ever grows. */
  overCoverageHours: number
}

export function createState(
  ctx: ProblemContext,
  order: Int32Array,
  localPenaltyTable: Float64Array[],
): SearchState {
  const employeeCount = ctx.employees.length
  const slotCount = employeeCount * DAYS_PER_WEEK

  const patternAt = new Int32Array(slotCount).fill(-1)
  const coverage = new Int32Array(WEEK_HOURS)
  const slack = new Int32Array(WEEK_HOURS)
  const employeeRemainingCapacity = new Int32Array(employeeCount)

  // Slack starts as "every undecided slot could still contribute", minus what is required.
  for (let slot = 0; slot < slotCount; slot++) {
    const day = slot % DAYS_PER_WEEK
    const mask = ctx.coverableMask[slot]
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      if (mask & (1 << hour)) slack[slotIndex(day, hour)]++
    }
    employeeRemainingCapacity[Math.floor(slot / DAYS_PER_WEEK)] += ctx.maxHoursPerSlot[slot]
  }

  let negativeSlack = 0
  for (let i = 0; i < WEEK_HOURS; i++) {
    slack[i] -= ctx.config.minCoverage[i]
    if (slack[i] < 0) negativeSlack++
  }

  return {
    ctx,
    order,
    localPenaltyTable,
    depth: 0,
    patternAt,
    coverage,
    slack,
    negativeSlack,
    employeeHours: new Int32Array(employeeCount),
    employeeRemainingCapacity,
    employeeDecidedDays: new Int32Array(employeeCount),
    localPenalty: 0,
    overCoverageHours: 0,
  }
}

/** Commits the pattern choice for the slot at the current depth and advances. */
export function applyPattern(state: SearchState, patternIndex: number): void {
  const { ctx } = state
  const slot = state.order[state.depth]
  const employee = Math.floor(slot / DAYS_PER_WEEK)
  const day = slot % DAYS_PER_WEEK
  const pattern = ctx.patterns[slot][patternIndex]
  const dayBase = day * HOURS_PER_DAY

  // Hours this slot could have covered but now won't: one fewer potential contributor.
  // Hours it does cover keep their slack (lost a potential, gained an actual).
  const forfeited = ctx.coverableMask[slot] & ~pattern.mask
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    if (forfeited & (1 << hour)) {
      if (--state.slack[dayBase + hour] === -1) state.negativeSlack++
    }
  }

  const mask = pattern.mask
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    if (mask & (1 << hour)) {
      const idx = dayBase + hour
      if (state.coverage[idx]++ >= ctx.config.minCoverage[idx]) state.overCoverageHours++
    }
  }

  state.employeeHours[employee] += pattern.hours
  state.employeeRemainingCapacity[employee] -= ctx.maxHoursPerSlot[slot]
  state.employeeDecidedDays[employee]++
  state.patternAt[slot] = patternIndex
  state.localPenalty += state.localPenaltyTable[slot][patternIndex]
  state.depth++
}

/** Exact inverse of {@link applyPattern}. */
export function undoPattern(state: SearchState): void {
  const { ctx } = state
  state.depth--
  const slot = state.order[state.depth]
  const employee = Math.floor(slot / DAYS_PER_WEEK)
  const day = slot % DAYS_PER_WEEK
  const patternIndex = state.patternAt[slot]
  const pattern = ctx.patterns[slot][patternIndex]
  const dayBase = day * HOURS_PER_DAY

  state.localPenalty -= state.localPenaltyTable[slot][patternIndex]
  state.patternAt[slot] = -1
  state.employeeDecidedDays[employee]--
  state.employeeRemainingCapacity[employee] += ctx.maxHoursPerSlot[slot]
  state.employeeHours[employee] -= pattern.hours

  const mask = pattern.mask
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    if (mask & (1 << hour)) {
      const idx = dayBase + hour
      if (--state.coverage[idx] >= ctx.config.minCoverage[idx]) state.overCoverageHours--
    }
  }

  const forfeited = ctx.coverableMask[slot] & ~pattern.mask
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    if (forfeited & (1 << hour)) {
      if (state.slack[dayBase + hour]++ === -1) state.negativeSlack--
    }
  }
}

export function isComplete(state: SearchState): boolean {
  return state.depth === state.order.length
}

/**
 * Upper bound on the hours an employee can finish with: their decided hours plus everything
 * their undecided days could still add, clamped by the hard weekly cap.
 */
export function maxAchievableHours(state: SearchState, employee: number): number {
  return Math.min(
    state.ctx.employees[employee].maxWeeklyHours,
    state.employeeHours[employee] + state.employeeRemainingCapacity[employee],
  )
}
