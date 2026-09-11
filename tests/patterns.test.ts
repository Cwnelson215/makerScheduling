import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/config'
import { enumerateDayPatterns, MAX_PATTERNS_PER_SLOT, PatternExplosionError } from '../src/core/patterns'
import {
  Availability,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  WEEK_HOURS,
  countBits,
  slotIndex,
  type Employee,
  type ScheduleConfig,
} from '../src/core/types'

function employeeWith(available: Partial<Record<number, [number, number][]>>, max = 40): Employee {
  const availability = new Uint8Array(WEEK_HOURS)
  for (const [day, ranges] of Object.entries(available)) {
    for (const [start, end] of ranges ?? []) {
      for (let hour = start; hour < end; hour++) {
        availability[slotIndex(Number(day), hour)] = Availability.Preferred
      }
    }
  }
  return { id: 'e', name: 'E', maxWeeklyHours: max, targetWeeklyHours: max, availability }
}

/** Maximal contiguous runs of set bits, low hour first. */
function runsOf(mask: number): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = []
  let start = -1
  for (let hour = 0; hour <= HOURS_PER_DAY; hour++) {
    const set = hour < HOURS_PER_DAY && (mask & (1 << hour)) !== 0
    if (set && start < 0) start = hour
    if (!set && start >= 0) {
      runs.push({ start, end: hour })
      start = -1
    }
  }
  return runs
}

/**
 * Independent re-statement of what makes a day legal, written as a *predicate* over a bitmask
 * rather than as a generator. The enumerator builds patterns constructively; this checks them
 * declaratively. Agreement between the two is meaningful precisely because neither shares
 * logic with the other.
 */
function isLegalMask(
  mask: number,
  employee: Employee,
  day: number,
  config: ScheduleConfig,
): boolean {
  const win = config.operatingHours[day]
  if (!win) return mask === 0
  if (mask === 0) return true

  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    if (!(mask & (1 << hour))) continue
    if (hour < win.startHour || hour >= win.endHour) return false
    if (employee.availability[slotIndex(day, hour)] === Availability.Unavailable) return false
  }

  const runs = runsOf(mask)
  const maxBlocks = config.allowSplitShifts ? config.maxBlocksPerDay : 1
  if (runs.length > maxBlocks) return false

  for (const run of runs) {
    const length = run.end - run.start
    if (length < config.minShiftLength || length > config.maxShiftLength) return false
  }
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].start - runs[i - 1].end < config.minGapBetweenBlocks) return false
  }
  if (countBits(mask) > Math.min(config.maxDailyHours, employee.maxWeeklyHours)) return false
  return true
}

describe('day-pattern enumeration', () => {
  const variants: { name: string; config: Partial<ScheduleConfig>; available: [number, number][] }[] =
    [
      {
        name: 'single block, 8h window',
        config: { minShiftLength: 3, maxShiftLength: 6, maxDailyHours: 6, allowSplitShifts: false, maxBlocksPerDay: 1 },
        available: [[9, 17]],
      },
      {
        name: 'split shifts, gap 2',
        config: { minShiftLength: 3, maxShiftLength: 5, maxDailyHours: 8, allowSplitShifts: true, minGapBetweenBlocks: 2, maxBlocksPerDay: 2 },
        available: [[8, 18]],
      },
      {
        name: 'split shifts, gap 1, three blocks',
        config: { minShiftLength: 2, maxShiftLength: 3, maxDailyHours: 8, allowSplitShifts: true, minGapBetweenBlocks: 1, maxBlocksPerDay: 3 },
        available: [[8, 18]],
      },
      {
        name: 'availability split by a hole',
        config: { minShiftLength: 2, maxShiftLength: 4, maxDailyHours: 7, allowSplitShifts: true, minGapBetweenBlocks: 1, maxBlocksPerDay: 2 },
        available: [[8, 12], [14, 18]],
      },
      {
        name: 'daily cap below two full blocks',
        config: { minShiftLength: 3, maxShiftLength: 6, maxDailyHours: 7, allowSplitShifts: true, minGapBetweenBlocks: 2, maxBlocksPerDay: 2 },
        available: [[8, 20]],
      },
      {
        name: 'window shorter than the minimum shift',
        config: { minShiftLength: 5, maxShiftLength: 8, maxDailyHours: 8, allowSplitShifts: false, maxBlocksPerDay: 1 },
        available: [[9, 12]],
      },
    ]

  for (const variant of variants) {
    it(`${variant.name}: enumerates exactly the legal masks`, () => {
      const day = 0
      const config: ScheduleConfig = {
        ...DEFAULT_CONFIG,
        ...variant.config,
        operatingHours: [{ startHour: 8, endHour: 20 }, ...new Array(6).fill(null)],
      }
      const employee = employeeWith({ 0: variant.available })

      const produced = enumerateDayPatterns(employee, day, config)
      const producedMasks = produced.map((p) => p.mask)

      // No duplicates: with a gap of at least 1, a mask determines its block decomposition,
      // so two identical masks would mean the same day-pattern generated twice.
      expect(new Set(producedMasks).size).toBe(producedMasks.length)

      // Sweep every subset of the operating window's 12 hours (8..19). Any legal mask must
      // live inside that window, so 2^12 candidates is an exhaustive comparison set.
      const expected = new Set<number>()
      for (let bits = 0; bits < 1 << 12; bits++) {
        const mask = bits << 8
        if (isLegalMask(mask, employee, day, config)) expected.add(mask)
      }

      expect(new Set(producedMasks)).toEqual(expected)
    })
  }

  it('always offers the day-off pattern first', () => {
    const config = { ...DEFAULT_CONFIG, operatingHours: [{ startHour: 9, endHour: 17 }, ...new Array(6).fill(null)] }
    const patterns = enumerateDayPatterns(employeeWith({ 0: [[9, 17]] }), 0, config)
    expect(patterns[0].mask).toBe(0)
    expect(patterns[0].hours).toBe(0)
    expect(patterns[0].blocks).toEqual([])
  })

  it('returns only the day-off pattern for a closed day', () => {
    const config = { ...DEFAULT_CONFIG, operatingHours: new Array(DAYS_PER_WEEK).fill(null) }
    expect(enumerateDayPatterns(employeeWith({ 0: [[9, 17]] }), 0, config)).toHaveLength(1)
  })

  it('respects a weekly cap tighter than the daily cap', () => {
    const config: ScheduleConfig = {
      ...DEFAULT_CONFIG,
      minShiftLength: 2,
      maxShiftLength: 8,
      maxDailyHours: 8,
      allowSplitShifts: false,
      maxBlocksPerDay: 1,
      operatingHours: [{ startHour: 9, endHour: 20 }, ...new Array(6).fill(null)],
    }
    const patterns = enumerateDayPatterns(employeeWith({ 0: [[9, 20]] }, 4), 0, config)
    for (const pattern of patterns) expect(pattern.hours).toBeLessThanOrEqual(4)
  })

  it('derived pattern fields agree with the mask', () => {
    const config: ScheduleConfig = {
      ...DEFAULT_CONFIG,
      minShiftLength: 2,
      maxShiftLength: 4,
      maxDailyHours: 8,
      allowSplitShifts: true,
      minGapBetweenBlocks: 1,
      maxBlocksPerDay: 2,
      operatingHours: [{ startHour: 9, endHour: 17 }, ...new Array(6).fill(null)],
    }
    const availability = new Uint8Array(WEEK_HOURS)
    for (let hour = 9; hour < 13; hour++) availability[slotIndex(0, hour)] = Availability.Preferred
    for (let hour = 13; hour < 17; hour++) availability[slotIndex(0, hour)] = Availability.NotPreferred
    const employee: Employee = { id: 'e', name: 'E', maxWeeklyHours: 40, targetWeeklyHours: 20, availability }

    for (const pattern of enumerateDayPatterns(employee, 0, config)) {
      expect(pattern.hours).toBe(countBits(pattern.mask))
      expect(pattern.blockCount).toBe(pattern.blocks.length)

      const runs = runsOf(pattern.mask)
      expect(pattern.blocks.map((b) => ({ start: b.startHour, end: b.endHour }))).toEqual(runs)
      expect(pattern.blocks.every((b) => b.day === 0)).toBe(true)

      expect(pattern.nonPreferredHours).toBe(countBits(pattern.mask & 0x1e000)) // hours 13..16
      expect(pattern.worksOpening).toBe((pattern.mask & (1 << 9)) !== 0)
      expect(pattern.worksClosing).toBe((pattern.mask & (1 << 16)) !== 0)
    }
  })

  it('refuses to truncate an explosive pattern list', () => {
    // A wide window with a 1h minimum and many blocks blows past the cap. Truncating would
    // make the solver silently non-exhaustive, so it must throw instead.
    const config: ScheduleConfig = {
      ...DEFAULT_CONFIG,
      minShiftLength: 1,
      maxShiftLength: 24,
      maxDailyHours: 24,
      allowSplitShifts: true,
      minGapBetweenBlocks: 1,
      maxBlocksPerDay: 8,
      operatingHours: [{ startHour: 0, endHour: 24 }, ...new Array(6).fill(null)],
    }
    expect(() => enumerateDayPatterns(employeeWith({ 0: [[0, 24]] }), 0, config)).toThrow(
      PatternExplosionError,
    )
    expect(MAX_PATTERNS_PER_SLOT).toBeGreaterThan(1000)
  })
})
