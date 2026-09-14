import {
  isIsoDate,
  mondayOf,
  resolveWeek,
  spanIsValid,
  type DatedHours,
  type EmployeeExceptions,
  type TimeSpan,
} from './calendar'
import { DEFAULT_CONFIG } from './config'
import { normaliseRuleSettings, type RuleSetting } from './rules/catalog'
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

/** Time off on a date; omitting `hours` means the whole day. */
/**
 * Time off: one day (`date`, optionally just `hours` of it), or a continuous stretch `from` one
 * date `to` another. `fromHour` defaults to the start of `from`; without `toHour` the stretch runs
 * to the end of `to`, so `{ "from": "…22", "to": "…25" }` is four whole days.
 */
export type TimeOffJson =
  | { date: string; hours?: HourRange }
  | { from: string; to: string; fromHour?: number; toHour?: number }

/** Hours an employee must work on a date. */
export interface PinJson {
  date: string
  hours: HourRange
}

export type DayName = (typeof DAY_NAMES)[number]
export type PerDay<T> = Partial<Record<DayName, T>>

/**
 * Hand-writable scenario file. Availability is given as day → hour ranges rather than a
 * 168-entry grid; anything not listed as preferred or not-preferred is unavailable.
 */
export interface ScenarioJson {
  name?: string
  threshold?: number
  /** Monday of the week being scheduled, `YYYY-MM-DD`. Required when any employee has dated entries. */
  weekStart?: string
  /** Rule weights. Omitted rules take their catalog defaults. */
  rules?: Partial<RuleSetting>[]
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
    /** Dated; entries outside `weekStart`'s week are kept but have no effect. */
    timeOff?: TimeOffJson[]
    pins?: PinJson[]
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

export interface Scenario {
  name: string
  employees: Employee[]
  config: ScheduleConfig
  threshold: number
  rules: RuleSetting[]
  /** Monday of the week being scheduled, or `null` when the scenario has no dated entries. */
  weekStart: string | null
  /**
   * Dated time off and pins by employee id, kept apart from `employees` so the file round-trips
   * exactly. Solve with {@link scenarioEmployees}, which applies them.
   */
  exceptions: Record<string, EmployeeExceptions>
}

/** The scenario's employees with its dated time off and pins applied for its week. */
export function scenarioEmployees(scenario: Scenario): Employee[] {
  return resolveWeek(scenario.employees, scenario.weekStart, scenario.exceptions)
}

export function parseScenario(json: ScenarioJson): Scenario {
  const weekStart = json.weekStart ?? null
  if (weekStart !== null) {
    if (!isIsoDate(weekStart)) throw new ScenarioError(`weekStart "${weekStart}" is not a YYYY-MM-DD date`)
    if (mondayOf(weekStart) !== weekStart) {
      throw new ScenarioError(`weekStart "${weekStart}" must be a Monday (that week's Monday is ${mondayOf(weekStart)})`)
    }
  }

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

  const exceptions: Record<string, EmployeeExceptions> = {}
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

    const dated = (date: unknown, hours: HourRange, where: string): DatedHours => {
      if (weekStart === null) throw new ScenarioError(`${where}: dated entries need a top-level weekStart`)
      if (!isIsoDate(date)) throw new ScenarioError(`${where}: "${String(date)}" is not a YYYY-MM-DD date`)
      checkRange(hours, where)
      return { date, startHour: hours[0], endHour: hours[1] }
    }
    exceptions[raw.id] = {
      timeOff: (raw.timeOff ?? []).map((entry, i) => {
        const where = `employee "${raw.id}".timeOff[${i}]`
        if ('date' in entry) {
          const { date, startHour, endHour } = dated(entry.date, entry.hours ?? [0, HOURS_PER_DAY], where)
          return { startDate: date, startHour, endDate: date, endHour }
        }
        if (weekStart === null) throw new ScenarioError(`${where}: dated entries need a top-level weekStart`)
        const span: TimeSpan = {
          startDate: entry.from,
          startHour: entry.fromHour ?? 0,
          endDate: entry.to,
          endHour: entry.toHour ?? HOURS_PER_DAY,
        }
        if (!isIsoDate(span.startDate) || !isIsoDate(span.endDate)) {
          throw new ScenarioError(`${where}: "from" and "to" must be YYYY-MM-DD dates`)
        }
        if (!spanIsValid(span)) {
          throw new ScenarioError(`${where}: hours must be whole numbers 0–24 and the end must be after the start`)
        }
        return span
      }),
      pins: (raw.pins ?? []).map((entry, i) => {
        const where = `employee "${raw.id}".pins[${i}]`
        if (!Array.isArray(entry.hours)) throw new ScenarioError(`${where}: a pin needs hours`)
        return dated(entry.date, entry.hours, where)
      }),
    }

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
    rules: normaliseRuleSettings(json.rules),
    weekStart,
    exceptions,
  }
}

/** Contiguous `[start, end)` runs within `[from, to)` where `matches(hour)` holds. */
function runs(from: number, to: number, matches: (hour: number) => boolean): HourRange[] {
  const out: HourRange[] = []
  let start = -1
  for (let hour = from; hour <= to; hour++) {
    const hit = hour < to && matches(hour)
    if (hit && start < 0) start = hour
    if (!hit && start >= 0) {
      out.push([start, hour])
      start = -1
    }
  }
  return out
}

/**
 * Inverse of {@link parseScenario}: compresses 168-entry grids back into hand-readable hour
 * ranges. `parseScenario(serializeScenario(s))` reproduces `s` exactly.
 */
export function serializeScenario(scenario: Scenario): ScenarioJson {
  const { config } = scenario

  const operatingHours: PerDay<HourRange | null> = {}
  const minCoverage: PerDay<CoverageRange[]> = {}
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    const win = config.operatingHours[day]
    if (win) operatingHours[DAY_NAMES[day]] = [win.startHour, win.endHour]

    const ranges: CoverageRange[] = []
    let start = -1
    for (let hour = 0; hour <= HOURS_PER_DAY; hour++) {
      const need = hour < HOURS_PER_DAY ? config.minCoverage[slotIndex(day, hour)] : 0
      const current = start >= 0 ? config.minCoverage[slotIndex(day, start)] : 0
      if (start >= 0 && need !== current) {
        ranges.push([start, hour, current])
        start = -1
      }
      if (start < 0 && need > 0) start = hour
    }
    if (ranges.length > 0) minCoverage[DAY_NAMES[day]] = ranges
  }

  const employees = scenario.employees.map((employee) => {
    const preferred: PerDay<HourRange[]> = {}
    const notPreferred: PerDay<HourRange[]> = {}
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const level = (hour: number) => employee.availability[slotIndex(day, hour)]
      const p = runs(0, HOURS_PER_DAY, (h) => level(h) === Availability.Preferred)
      const n = runs(0, HOURS_PER_DAY, (h) => level(h) === Availability.NotPreferred)
      if (p.length > 0) preferred[DAY_NAMES[day]] = p
      if (n.length > 0) notPreferred[DAY_NAMES[day]] = n
    }
    const { timeOff = [], pins = [] } = scenario.exceptions[employee.id] ?? {}
    return {
      id: employee.id,
      name: employee.name,
      maxWeeklyHours: employee.maxWeeklyHours,
      targetWeeklyHours: employee.targetWeeklyHours,
      preferred,
      notPreferred,
      ...(timeOff.length > 0 && {
        timeOff: timeOff.map(({ startDate, startHour, endDate, endHour }): TimeOffJson => {
          if (startDate === endDate) {
            return startHour === 0 && endHour === HOURS_PER_DAY
              ? { date: startDate }
              : { date: startDate, hours: [startHour, endHour] }
          }
          return {
            from: startDate,
            to: endDate,
            ...(startHour !== 0 && { fromHour: startHour }),
            ...(endHour !== HOURS_PER_DAY && { toHour: endHour }),
          }
        }),
      }),
      ...(pins.length > 0 && {
        pins: pins.map(({ date, startHour, endHour }): PinJson => ({ date, hours: [startHour, endHour] })),
      }),
    }
  })

  return {
    name: scenario.name,
    threshold: scenario.threshold,
    ...(scenario.weekStart !== null && { weekStart: scenario.weekStart }),
    rules: scenario.rules,
    config: {
      operatingHours,
      minCoverage,
      minShiftLength: config.minShiftLength,
      maxShiftLength: config.maxShiftLength,
      maxDailyHours: config.maxDailyHours,
      allowSplitShifts: config.allowSplitShifts,
      minGapBetweenBlocks: config.minGapBetweenBlocks,
      maxBlocksPerDay: config.maxBlocksPerDay,
      maxConsecutiveDays: config.maxConsecutiveDays,
    },
    employees,
  }
}
