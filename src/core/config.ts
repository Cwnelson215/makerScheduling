import {
  Availability,
  DAY_NAMES,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  WEEK_HOURS,
  slotIndex,
  type Employee,
  type ScheduleConfig,
} from './types'

export const DEFAULT_CONFIG: ScheduleConfig = {
  operatingHours: Array.from({ length: DAYS_PER_WEEK }, () => ({ startHour: 8, endHour: 22 })),
  minCoverage: new Uint8Array(WEEK_HOURS),
  minShiftLength: 3,
  maxShiftLength: 8,
  maxDailyHours: 10,
  allowSplitShifts: true,
  minGapBetweenBlocks: 2,
  maxBlocksPerDay: 2,
  maxConsecutiveDays: 5,
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid schedule configuration:\n  - ${problems.join('\n  - ')}`)
    this.name = 'ConfigError'
  }
}

/**
 * Rejects configurations that are self-contradictory or provably unsatisfiable, so the
 * solver never burns a full search proving the obvious. Throws {@link ConfigError} listing
 * every problem found rather than only the first.
 */
export function validateProblem(employees: Employee[], config: ScheduleConfig): void {
  const problems: string[] = []

  if (employees.length === 0) problems.push('no employees provided')

  const seen = new Set<string>()
  for (const e of employees) {
    if (seen.has(e.id)) problems.push(`duplicate employee id "${e.id}"`)
    seen.add(e.id)
    if (e.availability.length !== WEEK_HOURS) {
      problems.push(`employee "${e.id}" availability grid must be ${WEEK_HOURS} entries`)
    }
    if (e.maxWeeklyHours < 0) problems.push(`employee "${e.id}" has negative maxWeeklyHours`)
    if (e.targetWeeklyHours > e.maxWeeklyHours) {
      problems.push(
        `employee "${e.id}" targetWeeklyHours (${e.targetWeeklyHours}) exceeds ` +
          `maxWeeklyHours (${e.maxWeeklyHours})`,
      )
    }
  }

  if (config.minShiftLength < 1) problems.push('minShiftLength must be at least 1')
  if (config.maxShiftLength < config.minShiftLength) {
    problems.push(
      `maxShiftLength (${config.maxShiftLength}) is below minShiftLength (${config.minShiftLength})`,
    )
  }
  if (config.maxDailyHours < config.minShiftLength) {
    problems.push(
      `maxDailyHours (${config.maxDailyHours}) is below minShiftLength (${config.minShiftLength})`,
    )
  }
  if (config.maxBlocksPerDay < 1) problems.push('maxBlocksPerDay must be at least 1')
  if (config.allowSplitShifts && config.minGapBetweenBlocks < 1) {
    problems.push('minGapBetweenBlocks must be at least 1 when split shifts are allowed')
  }
  if (config.minCoverage.length !== WEEK_HOURS) {
    problems.push(`minCoverage grid must be ${WEEK_HOURS} entries`)
  }
  if (config.operatingHours.length !== DAYS_PER_WEEK) {
    problems.push(`operatingHours must have ${DAYS_PER_WEEK} entries`)
  }

  for (let day = 0; day < Math.min(DAYS_PER_WEEK, config.operatingHours.length); day++) {
    const win = config.operatingHours[day]
    if (win === null) continue
    if (win.startHour < 0 || win.endHour > HOURS_PER_DAY || win.startHour >= win.endHour) {
      problems.push(
        `${DAY_NAMES[day]} operating window ${win.startHour}-${win.endHour} is not a valid range`,
      )
      continue
    }
    if (win.endHour - win.startHour < config.minShiftLength) {
      problems.push(
        `${DAY_NAMES[day]} is open ${win.endHour - win.startHour}h, shorter than ` +
          `minShiftLength (${config.minShiftLength}) — nobody can be scheduled`,
      )
    }
  }

  // Coverage demanded outside opening hours can never be met, and coverage demanded beyond
  // the number of available bodies is unsatisfiable no matter how the search branches.
  if (config.minCoverage.length === WEEK_HOURS && config.operatingHours.length === DAYS_PER_WEEK) {
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const win = config.operatingHours[day]
      for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        const need = config.minCoverage[slotIndex(day, hour)]
        if (need === 0) continue
        const isOpen = win !== null && hour >= win.startHour && hour < win.endHour
        if (!isOpen) {
          problems.push(
            `${DAY_NAMES[day]} ${fmtHour(hour)} requires ${need} staff but is outside operating hours`,
          )
          continue
        }
        let available = 0
        for (const e of employees) {
          if (e.availability[slotIndex(day, hour)] !== Availability.Unavailable) available++
        }
        if (available < need) {
          problems.push(
            `${DAY_NAMES[day]} ${fmtHour(hour)} requires ${need} staff but only ` +
              `${available} employee(s) are available then`,
          )
        }
      }
    }
  }

  if (problems.length > 0) throw new ConfigError(problems)
}

export function fmtHour(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${suffix}`
}

/** Builds a flat 7*24 coverage grid from a per-day headcount requirement. */
export function uniformCoverage(
  operatingHours: (import('./types').OperatingWindow | null)[],
  headcount: number,
): Uint8Array {
  const grid = new Uint8Array(WEEK_HOURS)
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    const win = operatingHours[day]
    if (!win) continue
    for (let hour = win.startHour; hour < win.endHour; hour++) grid[slotIndex(day, hour)] = headcount
  }
  return grid
}
