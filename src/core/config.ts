import { enumerateDayPatterns, pinnedMask } from './patterns'
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
    if (e.pinned !== undefined && e.pinned.length !== WEEK_HOURS) {
      problems.push(`employee "${e.id}" pinned grid must be ${WEEK_HOURS} entries`)
    }
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

  // Pins are checked last: deciding whether a legal shift can cover them means enumerating
  // patterns, which is only meaningful once the grids and shift limits above are sound.
  if (problems.length === 0) checkPins(employees, config, problems)

  if (problems.length > 0) throw new ConfigError(problems)
}

function checkPins(employees: Employee[], config: ScheduleConfig, problems: string[]): void {
  for (const e of employees) {
    if (!e.pinned) continue
    let minimumHours = 0

    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const required = pinnedMask(e, day)
      if (required === 0) continue
      const where = `${e.name || e.id} is pinned ${DAY_NAMES[day]}`

      const win = config.operatingHours[day]
      let outside = 0
      let unavailable = 0
      for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        if (!(required & (1 << hour))) continue
        if (win === null || hour < win.startHour || hour >= win.endHour) outside |= 1 << hour
        else if (e.availability[slotIndex(day, hour)] === Availability.Unavailable) unavailable |= 1 << hour
      }
      if (outside !== 0) problems.push(`${where} ${fmtHourRuns(outside)}, outside operating hours`)
      if (unavailable !== 0) {
        problems.push(`${where} ${fmtHourRuns(unavailable)} but is unavailable then (availability or time off)`)
      }
      if (outside !== 0 || unavailable !== 0) continue

      const patterns = enumerateDayPatterns(e, day, config)
      if (patterns.length === 0) {
        problems.push(
          `${where} ${fmtHourRuns(required)}, but no legal shift covers those hours — check ` +
            `shift length, split shift and daily-hours limits`,
        )
        continue
      }
      minimumHours += Math.min(...patterns.map((p) => p.hours))
    }

    if (minimumHours > e.maxWeeklyHours) {
      problems.push(
        `${e.name || e.id}'s pinned shifts need at least ${minimumHours}h, above their ` +
          `maxWeeklyHours (${e.maxWeeklyHours})`,
      )
    }
  }
}

/** `'9am–1pm, 3pm–5pm'` for the runs of set bits in a 24-bit hour mask. */
function fmtHourRuns(mask: number): string {
  const parts: string[] = []
  let start = -1
  for (let hour = 0; hour <= HOURS_PER_DAY; hour++) {
    const set = hour < HOURS_PER_DAY && (mask & (1 << hour)) !== 0
    if (set && start < 0) start = hour
    if (!set && start >= 0) {
      parts.push(fmtHourRange(start, hour))
      start = -1
    }
  }
  return parts.join(', ')
}

export function fmtHour(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${suffix}`
}

/** `'9am–1pm'` for `[start, end)`; an end of 24 reads as midnight rather than noon. */
export function fmtHourRange(startHour: number, endHour: number): string {
  return `${fmtHour(startHour)}–${endHour === HOURS_PER_DAY ? '12am' : fmtHour(endHour)}`
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
