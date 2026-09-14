import {
  Availability,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  WEEK_HOURS,
  slotIndex,
  type Employee,
} from './types'

/**
 * Calendar dates, kept at the edge of the model.
 *
 * The solver schedules an abstract Mon–Sun week and knows nothing about dates. Dated time off
 * and pins are resolved against a chosen week by {@link resolveWeek} just before solving, which
 * turns them into the week-level availability and `pinned` grids the solver already understands.
 */

/** A calendar date as `'YYYY-MM-DD'`. */
export type IsoDate = string

/** Hours on one calendar date. `endHour` is exclusive; a whole day is `0..24`. */
export interface DatedHours {
  date: IsoDate
  startHour: number
  endHour: number
}

/**
 * A continuous stretch of time, possibly across several days: from `startHour` on `startDate`
 * up to (not including) `endHour` on `endDate`. A single whole day is `0` to `24` on one date.
 */
export interface TimeSpan {
  startDate: IsoDate
  startHour: number
  endDate: IsoDate
  endHour: number
}

export interface EmployeeExceptions {
  /** Time the employee cannot work, overriding their recurring availability. */
  timeOff: TimeSpan[]
  /** Hours the employee must work. The solver may extend the shift around them. */
  pins: DatedHours[]
}

const MS_PER_DAY = 86_400_000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Days since the Unix epoch, or `null` when `date` is not a real calendar date.
 *
 * Everything works in whole UTC days, so daylight-saving transitions can never make a day 23 or
 * 25 hours long and shift an entry onto the wrong weekday.
 */
export function parseIsoDate(date: string): number | null {
  const match = ISO_DATE.exec(date)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  // Date.UTC rolls 2026-02-30 over to March 2; a real date survives the round trip unchanged.
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null
  }
  return ms / MS_PER_DAY
}

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && parseIsoDate(value) !== null
}

export function formatIsoDate(dayNumber: number): IsoDate {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10)
}

function mustParse(date: IsoDate): number {
  const day = parseIsoDate(date)
  if (day === null) throw new RangeError(`"${date}" is not a valid YYYY-MM-DD date`)
  return day
}

/** Monday on or before `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  const day = mustParse(date)
  // 1970-01-01 was a Thursday, so epoch day 0 is weekday 3 counting Monday as 0.
  const weekday = (((day + 3) % 7) + 7) % 7
  return formatIsoDate(day - weekday)
}

/** The local calendar date today, as an {@link IsoDate}. */
export function todayIso(now = new Date()): IsoDate {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return formatIsoDate(mustParse(date) + days)
}

/** `date`'s index in the week starting `weekStart` (0 = Monday), or `null` outside that week. */
export function weekDayIndex(weekStart: IsoDate, date: IsoDate): number | null {
  const offset = mustParse(date) - mustParse(weekStart)
  return offset >= 0 && offset < DAYS_PER_WEEK ? offset : null
}

/** Hours from the start of `weekStart` to `hour` on `date`; negative before the week. */
function weekHourOffset(weekStart: IsoDate, date: IsoDate, hour: number): number {
  return (mustParse(date) - mustParse(weekStart)) * HOURS_PER_DAY + hour
}

/** Real dates, whole hours within 0–24, and an end strictly after the start. */
export function spanIsValid(span: TimeSpan): boolean {
  const hourOk = (h: number) => Number.isInteger(h) && h >= 0 && h <= HOURS_PER_DAY
  if (!isIsoDate(span.startDate) || !isIsoDate(span.endDate)) return false
  if (!hourOk(span.startHour) || !hourOk(span.endHour)) return false
  return weekHourOffset(span.startDate, span.endDate, span.endHour) > span.startHour
}

/** Where a span sits relative to the week starting `weekStart`. */
export function spanTiming(weekStart: IsoDate, span: TimeSpan): 'past' | 'thisWeek' | 'later' {
  if (weekHourOffset(weekStart, span.endDate, span.endHour) <= 0) return 'past'
  if (weekHourOffset(weekStart, span.startDate, span.startHour) >= WEEK_HOURS) return 'later'
  return 'thisWeek'
}

/** Week-grid slots (`0..167`) the span covers within the week starting `weekStart`. */
export function spanSlots(weekStart: IsoDate, span: TimeSpan): { from: number; to: number } {
  const from = Math.max(0, weekHourOffset(weekStart, span.startDate, span.startHour))
  const to = Math.min(WEEK_HOURS, weekHourOffset(weekStart, span.endDate, span.endHour))
  return { from, to: Math.max(from, to) }
}

/** Short `'21 Sep'` label for a date. */
export function formatShortDate(date: IsoDate): string {
  const d = new Date(mustParse(date) * MS_PER_DAY)
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`
}

/** `'21–27 Sep 2026'`, spanning months or years as needed. */
export function formatWeekRange(weekStart: IsoDate): string {
  const first = new Date(mustParse(weekStart) * MS_PER_DAY)
  const last = new Date((mustParse(weekStart) + DAYS_PER_WEEK - 1) * MS_PER_DAY)
  const [fd, fm, fy] = [first.getUTCDate(), MONTH_NAMES[first.getUTCMonth()], first.getUTCFullYear()]
  const [ld, lm, ly] = [last.getUTCDate(), MONTH_NAMES[last.getUTCMonth()], last.getUTCFullYear()]
  if (fy !== ly) return `${fd} ${fm} ${fy} – ${ld} ${lm} ${ly}`
  if (fm !== lm) return `${fd} ${fm} – ${ld} ${lm} ${ly}`
  return `${fd}–${ld} ${lm} ${ly}`
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** `'Tue 22 Sep'`. */
export function formatDayDate(date: IsoDate): string {
  const weekday = WEEKDAYS[(((mustParse(date) + 3) % 7) + 7) % 7]
  return `${weekday} ${formatShortDate(date)}`
}

function clock(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${hour < 12 || hour === HOURS_PER_DAY ? 'am' : 'pm'}`
}

/**
 * `'Tue 22 Sep, all day'`, `'Tue 22 – Fri 25 Sep, all day'`, `'Tue 22 Sep, 9am–12pm'`, or
 * `'Tue 22 Sep 2pm – Thu 24 Sep 11am'`.
 */
export function formatSpan(span: TimeSpan): string {
  const wholeDays = span.startHour === 0 && span.endHour === HOURS_PER_DAY
  if (span.startDate === span.endDate) {
    return `${formatDayDate(span.startDate)}, ${wholeDays ? 'all day' : `${clock(span.startHour)}–${clock(span.endHour)}`}`
  }
  if (wholeDays) {
    const [first, last] = [formatDayDate(span.startDate), formatDayDate(span.endDate)]
    // Drop the repeated month: 'Tue 22 – Fri 25 Sep'.
    const sameMonth = span.startDate.slice(0, 7) === span.endDate.slice(0, 7)
    return `${sameMonth ? first.replace(/ \w+$/, '') : first} – ${last}, all day`
  }
  return `${formatDayDate(span.startDate)} ${clock(span.startHour)} – ${formatDayDate(span.endDate)} ${clock(span.endHour)}`
}

/**
 * Applies dated exceptions for the week starting `weekStart`: time off paints hours
 * {@link Availability.Unavailable}, pins set the employee's `pinned` grid. Entries dated outside
 * the week are ignored. Returns new employees; the inputs are never mutated.
 *
 * Time off wins over recurring availability by construction. A pin on an hour that ends up
 * unavailable is left for {@link import('./config').validateProblem} to report, rather than
 * silently resolved one way or the other.
 */
export function resolveWeek(
  employees: Employee[],
  weekStart: IsoDate | null,
  exceptionsById: Record<string, EmployeeExceptions | undefined>,
): Employee[] {
  return employees.map((employee) => {
    const exceptions = exceptionsById[employee.id]
    if (!weekStart || !exceptions || (exceptions.timeOff.length === 0 && exceptions.pins.length === 0)) {
      return employee
    }

    const availability = Uint8Array.from(employee.availability)
    const pinned = employee.pinned ? Uint8Array.from(employee.pinned) : new Uint8Array(WEEK_HOURS)
    let anyPinned = employee.pinned !== undefined

    for (const span of exceptions.timeOff) {
      const { from, to } = spanSlots(weekStart, span)
      for (let slot = from; slot < to; slot++) availability[slot] = Availability.Unavailable
    }
    for (const entry of exceptions.pins) {
      const day = weekDayIndex(weekStart, entry.date)
      if (day === null) continue
      for (let hour = Math.max(0, entry.startHour); hour < Math.min(HOURS_PER_DAY, entry.endHour); hour++) {
        pinned[slotIndex(day, hour)] = 1
        anyPinned = true
      }
    }

    return anyPinned ? { ...employee, availability, pinned } : { ...employee, availability }
  })
}
