import { maxAchievableHours } from '../state'
import {
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  WEEK_HOURS,
  type DayPattern,
  type ProblemContext,
} from '../types'
import type { Rule } from './types'

function patternFor(indices: Int32Array, slot: number, ctx: ProblemContext): DayPattern {
  return ctx.patterns[slot][indices[slot]]
}

function hoursPerEmployee(indices: Int32Array, ctx: ProblemContext): Int32Array {
  const hours = new Int32Array(ctx.employees.length)
  for (let e = 0; e < ctx.employees.length; e++) {
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      hours[e] += patternFor(indices, e * DAYS_PER_WEEK + day, ctx).hours
    }
  }
  return hours
}

function coverageOf(indices: Int32Array, ctx: ProblemContext): Int32Array {
  const coverage = new Int32Array(WEEK_HOURS)
  for (let e = 0; e < ctx.employees.length; e++) {
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const mask = patternFor(indices, e * DAYS_PER_WEEK + day, ctx).mask
      for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        if (mask & (1 << hour)) coverage[day * HOURS_PER_DAY + hour]++
      }
    }
  }
  return coverage
}

/**
 * Penalty for stretches of worked days longer than `maxConsecutive`.
 *
 * `worked` returns 1 (worked), 0 (day off) or -1 (still undecided). Undecided days break the
 * run, which makes this a valid *lower* bound: splitting a run can only lower the count, since
 * `max(0,a-m) + max(0,b-m) <= max(0,a+b-m)`. It also makes it monotone — deciding more days can
 * only extend or merge runs, never shorten them.
 */
function consecutiveRunPenalty(worked: (day: number) => number, maxConsecutive: number): number {
  let penalty = 0
  let run = 0
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    if (worked(day) === 1) {
      run++
    } else {
      penalty += Math.max(0, run - maxConsecutive)
      run = 0
    }
  }
  return penalty + Math.max(0, run - maxConsecutive)
}

/** Counts closing-then-opening-next-morning pairs. Weeks do not wrap Sunday into Monday. */
function clopenPairs(
  patternOn: (day: number) => DayPattern | null,
  ctx: ProblemContext,
): number {
  let count = 0
  for (let day = 0; day < DAYS_PER_WEEK - 1; day++) {
    if (ctx.closingHour[day] < 0 || ctx.openingHour[day + 1] < 0) continue
    const today = patternOn(day)
    const tomorrow = patternOn(day + 1)
    if (today && tomorrow && today.worksClosing && tomorrow.worksOpening) count++
  }
  return count
}

// ---------------------------------------------------------------------------
// Local rules — penalty decided by a single (employee, day, pattern).
// Precomputed into a lookup table, tracked incrementally, exactly tight.
// ---------------------------------------------------------------------------

export function nonPreferredHourRule(weight = 1): Rule {
  return {
    id: 'nonPreferredHour',
    label: 'Hours worked in a not-preferred slot',
    weight,
    patternPenalty: (pattern) => pattern.nonPreferredHours,
    final: (indices, ctx) => {
      let total = 0
      for (let slot = 0; slot < indices.length; slot++) {
        total += patternFor(indices, slot, ctx).nonPreferredHours
      }
      return total
    },
  }
}

export function splitShiftRule(weight = 3): Rule {
  return {
    id: 'splitShift',
    label: 'Split shifts assigned',
    weight,
    patternPenalty: (pattern) => Math.max(0, pattern.blockCount - 1),
    final: (indices, ctx) => {
      let total = 0
      for (let slot = 0; slot < indices.length; slot++) {
        total += Math.max(0, patternFor(indices, slot, ctx).blockCount - 1)
      }
      return total
    },
  }
}

/** Penalises blocks shorter than `comfortableLength` — legal, but not worth someone's commute. */
export function shortShiftRule(weight = 2, comfortableLength = 4): Rule {
  const count = (pattern: DayPattern): number =>
    pattern.blocks.reduce(
      (n, b) => n + (b.endHour - b.startHour < comfortableLength ? 1 : 0),
      0,
    )
  return {
    id: 'shortShift',
    label: `Blocks shorter than ${comfortableLength}h`,
    weight,
    patternPenalty: count,
    final: (indices, ctx) => {
      let total = 0
      for (let slot = 0; slot < indices.length; slot++) {
        total += count(patternFor(indices, slot, ctx))
      }
      return total
    },
  }
}

// ---------------------------------------------------------------------------
// Global rules — need to see across slots. Each supplies a monotone lower bound.
// ---------------------------------------------------------------------------

/** Tight bound: coverage only ever grows, so the running excess is already unavoidable. */
export function overCoverageRule(weight = 1): Rule {
  return {
    id: 'overCoverage',
    label: 'Staffed hours above the required minimum',
    weight,
    lowerBound: (state) => state.overCoverageHours,
    final: (indices, ctx) => {
      const coverage = coverageOf(indices, ctx)
      let total = 0
      for (let i = 0; i < WEEK_HOURS; i++) {
        total += Math.max(0, coverage[i] - ctx.config.minCoverage[i])
      }
      return total
    },
  }
}

/**
 * Weak early, tightening as capacity drains: the shortfall only becomes unavoidable once an
 * employee's remaining days can no longer close the gap to their target.
 */
export function underTargetHoursRule(weight = 2): Rule {
  return {
    id: 'underTargetHours',
    label: 'Hours below an employee target',
    weight,
    lowerBound: (state, ctx) => {
      let total = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        total += Math.max(0, ctx.employees[e].targetWeeklyHours - maxAchievableHours(state, e))
      }
      return total
    },
    final: (indices, ctx) => {
      const hours = hoursPerEmployee(indices, ctx)
      let total = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        total += Math.max(0, ctx.employees[e].targetWeeklyHours - hours[e])
      }
      return total
    },
  }
}

/** Tight bound: assigned hours only grow, so any current excess is already locked in. */
export function overTargetHoursRule(weight = 2): Rule {
  return {
    id: 'overTargetHours',
    label: 'Hours above an employee target',
    weight,
    lowerBound: (state, ctx) => {
      let total = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        total += Math.max(0, state.employeeHours[e] - ctx.employees[e].targetWeeklyHours)
      }
      return total
    },
    final: (indices, ctx) => {
      const hours = hoursPerEmployee(indices, ctx)
      let total = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        total += Math.max(0, hours[e] - ctx.employees[e].targetWeeklyHours)
      }
      return total
    },
  }
}

export function consecutiveDaysRule(weight = 5): Rule {
  return {
    id: 'consecutiveDays',
    label: 'Days worked beyond the consecutive-day limit',
    weight,
    lowerBound: (state, ctx) => {
      let total = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        total += consecutiveRunPenalty((day) => {
          const slot = e * DAYS_PER_WEEK + day
          const idx = state.patternAt[slot]
          if (idx < 0) return -1
          return ctx.patterns[slot][idx].hours > 0 ? 1 : 0
        }, ctx.config.maxConsecutiveDays)
      }
      return total
    },
    final: (indices, ctx) => {
      let total = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        total += consecutiveRunPenalty(
          (day) => (patternFor(indices, e * DAYS_PER_WEEK + day, ctx).hours > 0 ? 1 : 0),
          ctx.config.maxConsecutiveDays,
        )
      }
      return total
    },
  }
}

/** Closing shift followed by the next morning's opening. Counted once both days are decided. */
export function clopenRule(weight = 8): Rule {
  return {
    id: 'clopen',
    label: 'Close-then-open turnarounds',
    weight,
    lowerBound: (state, ctx) => {
      let total = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        total += clopenPairs((day) => {
          const slot = e * DAYS_PER_WEEK + day
          const idx = state.patternAt[slot]
          return idx < 0 ? null : ctx.patterns[slot][idx]
        }, ctx)
      }
      return total
    },
    final: (indices, ctx) => {
      let total = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        total += clopenPairs((day) => patternFor(indices, e * DAYS_PER_WEEK + day, ctx), ctx)
      }
      return total
    },
  }
}

/**
 * Fairness: the spread between the busiest and quietest employee.
 *
 * The bound uses the fact that each employee's final hours lie in
 * `[hoursSoFar, maxAchievable]`. So the final maximum is at least `max(hoursSoFar)` and the
 * final minimum is at most `min(maxAchievable)`. The first only rises and the second only
 * falls, so the gap between them is monotone — and exact once nothing is left to assign.
 */
export function evenDistributionRule(weight = 1): Rule {
  return {
    id: 'evenDistribution',
    label: 'Spread between the most and least scheduled employee',
    weight,
    lowerBound: (state, ctx) => {
      let highestFloor = 0
      let lowestCeiling = Infinity
      for (let e = 0; e < ctx.employees.length; e++) {
        highestFloor = Math.max(highestFloor, state.employeeHours[e])
        lowestCeiling = Math.min(lowestCeiling, maxAchievableHours(state, e))
      }
      return Math.max(0, highestFloor - lowestCeiling)
    },
    final: (indices, ctx) => {
      const hours = hoursPerEmployee(indices, ctx)
      let min = Infinity
      let max = 0
      for (let e = 0; e < ctx.employees.length; e++) {
        min = Math.min(min, hours[e])
        max = Math.max(max, hours[e])
      }
      return Math.max(0, max - min)
    },
  }
}

/** The standard rule set with default weights. Admins override weights or drop rules entirely. */
export function defaultRules(): Rule[] {
  return [
    nonPreferredHourRule(),
    splitShiftRule(),
    shortShiftRule(),
    overCoverageRule(),
    underTargetHoursRule(),
    overTargetHoursRule(),
    consecutiveDaysRule(),
    clopenRule(),
    evenDistributionRule(),
  ]
}
