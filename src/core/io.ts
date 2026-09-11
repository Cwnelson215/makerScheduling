import { DEFAULT_CONFIG } from './config'
import {
  Availability,
  DAY_NAMES,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  WEEK_HOURS,
  slotIndex,
  type Employee,
  type OperatingWindow,
  type ScheduleConfig,
} from './types'

/** `[startHour, endHourExclusive]`. */
export type HourRange = [number, number]
/** `[startHour, endHourExclusive, headcount]`. */
export type CoverageRange = [number, number, number]

export type DayName = (typeof DAY_NAMES)[number]
export type PerDay<T> = Partial<Record<DayName, T>>

/**
 * Hand-writable scenario file. Availability is given as day → hour ranges rather than a
 * 168-entry grid; anything not listed as preferred or not-preferred is unavailable.
 */
export interface ScenarioJson {
  name?: string
  threshold?: number
  config: {
    /** Day → `[open, close]`. Days omitted (or `null`) are closed. */
    operatingHours: PerDay<HourRange | null>
    /** A flat headcount for every operating hour, or per-day ranges with their own counts. */
    minCoverage: number | PerDay<CoverageRange[]>
    minShiftLength?: number
    maxShiftLength?: number
    maxDailyHours?: number
    allowSplitShifts?: boolean
    minGapBetweenBlocks?: number
    maxBlocksPerDay?: number
    maxConsecutiveDays?: number
  }
  employees: {
    id: string
    name: string
    maxWeeklyHours: number
    targetWeeklyHours: number
    preferred?: PerDay<HourRange[]>
    notPreferred?: PerDay<HourRange[]>
  }[]
}

export class ScenarioError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScenarioError'
  }
}

const DAY_INDEX = new Map<string, number>(DAY_NAMES.map((n, i) => [n, i]))

function dayIndex(key: string, where: string): number {
  const index = DAY_INDEX.get(key)
  if (index === undefined) {
    throw new ScenarioError(
      `unknown day "${key}" in ${where}; expected one of ${DAY_NAMES.join(', ')}`,
    )
  }
  return index
}

function checkRange([start, end]: HourRange, where: string): void {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new ScenarioError(`${where}: hour range [${start}, ${end}] must use whole hours`)
  }
  if (start < 0 || end > HOURS_PER_DAY || start >= end) {
    throw new ScenarioError(
      `${where}: hour range [${start}, ${end}] is out of bounds or empty ` +
        `(expected 0 <= start < end <= ${HOURS_PER_DAY})`,
    )
  }
}

export function parseScenario(json: ScenarioJson): {
  name: string
  employees: Employee[]
  config: ScheduleConfig
  threshold: number
} {
  const operatingHours: (OperatingWindow | null)[] = new Array(DAYS_PER_WEEK).fill(null)
  for (const [key, range] of Object.entries(json.config.operatingHours)) {
    const day = dayIndex(key, 'config.operatingHours')
    if (range === null || range === undefined) continue
    checkRange(range, `config.operatingHours.${key}`)
    operatingHours[day] = { startHour: range[0], endHour: range[1] }
  }

  const minCoverage = new Uint8Array(WEEK_HOURS)
  if (typeof json.config.minCoverage === 'number') {
    const headcount = json.config.minCoverage
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const win = operatingHours[day]
      if (!win) continue
      for (let hour = win.startHour; hour < win.endHour; hour++) {
        minCoverage[slotIndex(day, hour)] = headcount
      }
    }
  } else {
    for (const [key, ranges] of Object.entries(json.config.minCoverage)) {
      const day = dayIndex(key, 'config.minCoverage')
      for (const [start, end, headcount] of ranges ?? []) {
        checkRange([start, end], `config.minCoverage.${key}`)
        for (let hour = start; hour < end; hour++) minCoverage[slotIndex(day, hour)] = headcount
      }
    }
  }

  const config: ScheduleConfig = {
    ...DEFAULT_CONFIG,
    operatingHours,
    minCoverage,
    minShiftLength: json.config.minShiftLength ?? DEFAULT_CONFIG.minShiftLength,
    maxShiftLength: json.config.maxShiftLength ?? DEFAULT_CONFIG.maxShiftLength,
    maxDailyHours: json.config.maxDailyHours ?? DEFAULT_CONFIG.maxDailyHours,
    allowSplitShifts: json.config.allowSplitShifts ?? DEFAULT_CONFIG.allowSplitShifts,
    minGapBetweenBlocks: json.config.minGapBetweenBlocks ?? DEFAULT_CONFIG.minGapBetweenBlocks,
    maxBlocksPerDay: json.config.maxBlocksPerDay ?? DEFAULT_CONFIG.maxBlocksPerDay,
    maxConsecutiveDays: json.config.maxConsecutiveDays ?? DEFAULT_CONFIG.maxConsecutiveDays,
  }

  const employees: Employee[] = json.employees.map((raw) => {
    const availability = new Uint8Array(WEEK_HOURS) // defaults to Unavailable
    const paint = (spec: PerDay<HourRange[]> | undefined, level: Availability, field: string) => {
      for (const [key, ranges] of Object.entries(spec ?? {})) {
        const day = dayIndex(key, `employee "${raw.id}".${field}`)
        for (const range of ranges ?? []) {
          checkRange(range, `employee "${raw.id}".${field}.${key}`)
          for (let hour = range[0]; hour < range[1]; hour++) {
            availability[slotIndex(day, hour)] = level
          }
        }
      }
    }
    // Painted in this order so an explicit not-preferred range wins over an overlapping
    // preferred one — the more cautious reading of a contradictory profile.
    paint(raw.preferred, Availability.Preferred, 'preferred')
    paint(raw.notPreferred, Availability.NotPreferred, 'notPreferred')

    return {
      id: raw.id,
      name: raw.name,
      maxWeeklyHours: raw.maxWeeklyHours,
      targetWeeklyHours: raw.targetWeeklyHours,
      availability,
    }
  })

  return {
    name: json.name ?? 'scenario',
    employees,
    config,
    threshold: json.threshold ?? 0,
  }
}
