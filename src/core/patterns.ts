import {
  Availability,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  countBits,
  slotIndex,
  type DayPattern,
  type Employee,
  type ProblemContext,
  type ScheduleConfig,
} from './types'

/**
 * Refuses to build an absurd candidate list rather than silently truncating it — a truncated
 * pattern list would make the solver quietly non-exhaustive, which is exactly the failure mode
 * the whole design is trying to avoid.
 */
export const MAX_PATTERNS_PER_SLOT = 50_000

export class PatternExplosionError extends Error {
  constructor(employeeId: string, day: number) {
    super(
      `Employee "${employeeId}" has more than ${MAX_PATTERNS_PER_SLOT} legal day-patterns on ` +
        `day ${day}. Tighten minShiftLength, maxBlocksPerDay, or the operating window.`,
    )
    this.name = 'PatternExplosionError'
  }
}

const EMPTY_PATTERN: DayPattern = {
  blocks: [],
  mask: 0,
  hours: 0,
  blockCount: 0,
  nonPreferredHours: 0,
  worksClosing: false,
  worksOpening: false,
}

/** Bitmask of the hours `employee` is pinned to on `day`; 0 when nothing is pinned. */
export function pinnedMask(employee: Employee, day: number): number {
  if (!employee.pinned) return 0
  let mask = 0
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    if (employee.pinned[slotIndex(day, hour)] !== 0) mask |= 1 << hour
  }
  return mask
}

/**
 * Every legal way `employee` can work `day`. Includes the empty "day off" pattern, first,
 * unless the day has pinned hours.
 *
 * Shift-length bounds, the split-shift gap, and the daily-hours cap are applied while
 * generating, so an illegal shape is never constructed and never needs rejecting later. Pins
 * then keep only the patterns covering every pinned hour — possibly none, when no legal shift
 * can, which {@link import('./config').validateProblem} reports.
 */
export function enumerateDayPatterns(
  employee: Employee,
  day: number,
  config: ScheduleConfig,
): DayPattern[] {
  const required = pinnedMask(employee, day)
  const patterns = generateDayPatterns(employee, day, config)
  return required === 0 ? patterns : patterns.filter((p) => (p.mask & required) === required)
}

function generateDayPatterns(
  employee: Employee,
  day: number,
  config: ScheduleConfig,
): DayPattern[] {
  const patterns: DayPattern[] = [EMPTY_PATTERN]
  const win = config.operatingHours[day]
  if (!win) return patterns

  const dailyCap = Math.min(config.maxDailyHours, employee.maxWeeklyHours)
  if (dailyCap < config.minShiftLength) return patterns

  const workable: boolean[] = new Array(HOURS_PER_DAY).fill(false)
  for (let hour = win.startHour; hour < win.endHour; hour++) {
    workable[hour] = employee.availability[slotIndex(day, hour)] !== Availability.Unavailable
  }

  const maxBlocks = config.allowSplitShifts ? config.maxBlocksPerDay : 1
  const stack: { startHour: number; endHour: number }[] = []

  const extend = (minStart: number, hoursSoFar: number): void => {
    for (let start = minStart; start < win.endHour; start++) {
      if (!workable[start]) continue

      // Longest contiguous workable run beginning at `start`, capped by maxShiftLength.
      let runEnd = start
      while (runEnd < win.endHour && workable[runEnd]) runEnd++
      const latestEnd = Math.min(runEnd, start + config.maxShiftLength)

      for (let end = start + config.minShiftLength; end <= latestEnd; end++) {
        const length = end - start
        if (hoursSoFar + length > dailyCap) break // length only grows from here

        stack.push({ startHour: start, endHour: end })
        if (patterns.length >= MAX_PATTERNS_PER_SLOT) {
          throw new PatternExplosionError(employee.id, day)
        }
        patterns.push(materialise(stack, employee, day, win.startHour, win.endHour))

        if (stack.length < maxBlocks) {
          extend(end + config.minGapBetweenBlocks, hoursSoFar + length)
        }
        stack.pop()
      }
    }
  }

  extend(win.startHour, 0)
  return patterns
}

function materialise(
  stack: { startHour: number; endHour: number }[],
  employee: Employee,
  day: number,
  openingHour: number,
  closingHourExclusive: number,
): DayPattern {
  let mask = 0
  let nonPreferredHours = 0
  for (const block of stack) {
    for (let hour = block.startHour; hour < block.endHour; hour++) {
      mask |= 1 << hour
      if (employee.availability[slotIndex(day, hour)] === Availability.NotPreferred) {
        nonPreferredHours++
      }
    }
  }
  return {
    blocks: stack.map((b) => ({ day, startHour: b.startHour, endHour: b.endHour })),
    mask,
    hours: countBits(mask),
    blockCount: stack.length,
    nonPreferredHours,
    worksOpening: (mask & (1 << openingHour)) !== 0,
    worksClosing: (mask & (1 << (closingHourExclusive - 1))) !== 0,
  }
}

/** Precomputes everything the search treats as immutable. */
export function buildProblemContext(
  employees: Employee[],
  config: ScheduleConfig,
): ProblemContext {
  const slotCount = employees.length * DAYS_PER_WEEK
  const patterns: DayPattern[][] = new Array(slotCount)
  const maxHoursPerSlot = new Int32Array(slotCount)
  const coverableMask = new Int32Array(slotCount)

  for (let e = 0; e < employees.length; e++) {
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const slot = e * DAYS_PER_WEEK + day
      const list = enumerateDayPatterns(employees[e], day, config)
      let maxHours = 0
      let union = 0
      for (const p of list) {
        if (p.hours > maxHours) maxHours = p.hours
        union |= p.mask
      }
      patterns[slot] = list
      maxHoursPerSlot[slot] = maxHours
      coverableMask[slot] = union
    }
  }

  const openingHour = new Int32Array(DAYS_PER_WEEK).fill(-1)
  const closingHour = new Int32Array(DAYS_PER_WEEK).fill(-1)
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    const win = config.operatingHours[day]
    if (!win) continue
    openingHour[day] = win.startHour
    closingHour[day] = win.endHour - 1
  }

  return { employees, config, patterns, maxHoursPerSlot, coverableMask, openingHour, closingHour }
}
