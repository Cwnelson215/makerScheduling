export const DAYS_PER_WEEK = 7
export const HOURS_PER_DAY = 24
export const WEEK_HOURS = DAYS_PER_WEEK * HOURS_PER_DAY

/** Perfect score. Rules only ever subtract from this — see rules/types.ts. */
export const MAX_SCORE = 100

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** How an employee feels about working a given hour. */
export enum Availability {
  Unavailable = 0,
  NotPreferred = 1,
  Preferred = 2,
}

/** Index into a flat 7*24 week grid. */
export function slotIndex(day: number, hour: number): number {
  return day * HOURS_PER_DAY + hour
}

export interface Employee {
  id: string
  name: string
  /** Hard constraint — a schedule assigning more than this is invalid, never merely penalised. */
  maxWeeklyHours: number
  /** Soft target — drives the under/over-target penalty rules. */
  targetWeeklyHours: number
  /** Flat 7*24 grid of {@link Availability}, indexed by {@link slotIndex}. */
  availability: Uint8Array
  /**
   * Optional flat 7*24 grid; a non-zero entry means the employee must work that hour. A hard
   * constraint — every day-pattern generated for a pinned day covers its pinned hours, and may
   * extend beyond them.
   */
  pinned?: Uint8Array
}

/** A contiguous run of worked hours on one day. `endHour` is exclusive. */
export interface ShiftBlock {
  day: number
  startHour: number
  endHour: number
}

export interface OperatingWindow {
  startHour: number
  /** Exclusive. */
  endHour: number
}

export interface ScheduleConfig {
  /** Per day of week; `null` means closed that day. */
  operatingHours: (OperatingWindow | null)[]
  /** Flat 7*24 grid of required headcount per hour. */
  minCoverage: Uint8Array
  minShiftLength: number
  maxShiftLength: number
  maxDailyHours: number
  allowSplitShifts: boolean
  /** Minimum idle hours between two blocks on the same day. */
  minGapBetweenBlocks: number
  maxBlocksPerDay: number
  maxConsecutiveDays: number
}

/**
 * One legal way an employee can work one day. Enumerated up front by
 * {@link import('./patterns').enumerateDayPatterns} so that shift-shape constraints
 * act as generators rather than as post-hoc checks — illegal shapes are never built.
 */
export interface DayPattern {
  blocks: ShiftBlock[]
  /** 24-bit mask of worked hours; bit `h` set means hour `h` is worked. */
  mask: number
  /** Total worked hours (popcount of `mask`). */
  hours: number
  blockCount: number
  /** Hours worked that the employee marked {@link Availability.NotPreferred}. */
  nonPreferredHours: number
  /** True when this pattern works the final operating hour of the day. */
  worksClosing: boolean
  /** True when this pattern works the first operating hour of the day. */
  worksOpening: boolean
}

/** A fully-assigned schedule, scored. */
export interface Schedule {
  /** Flat `employeeIndex * 7 + day` → index into `ctx.patterns[employeeIndex * 7 + day]`. */
  patternIndices: Int32Array
  /** Worked blocks per employee, in `employees` order. */
  blocks: ShiftBlock[][]
  hoursPerEmployee: number[]
  score: number
  /** Weighted penalty contributed by each rule id. */
  penalties: Record<string, number>
}

/** Immutable problem definition, shared across the whole search. */
export interface ProblemContext {
  employees: Employee[]
  config: ScheduleConfig
  /**
   * `patterns[employeeIndex * 7 + day]` — every legal day-pattern for that slot. The empty
   * "day off" pattern sits at index 0 unless the day has pinned hours, in which case it is not
   * legal and is absent.
   */
  patterns: DayPattern[][]
  /** `maxHoursPerSlot[e * 7 + d]` — most hours employee `e` could possibly work on day `d`. */
  maxHoursPerSlot: Int32Array
  /** `coverableMask[e * 7 + d]` — union of every pattern mask for that slot. */
  coverableMask: Int32Array
  /** First and last operating hour per day; `-1` when closed. */
  openingHour: Int32Array
  closingHour: Int32Array
}

export function countBits(mask: number): number {
  let n = 0
  let m = mask
  while (m !== 0) {
    m &= m - 1
    n++
  }
  return n
}
