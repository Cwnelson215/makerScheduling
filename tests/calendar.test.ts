import { describe, expect, it } from 'vitest'
import {
  addDays,
  formatSpan,
  formatWeekRange,
  mondayOf,
  parseIsoDate,
  resolveWeek,
  spanIsValid,
  spanTiming,
  todayIso,
  weekDayIndex,
} from '../src/core/calendar'
import { Availability, WEEK_HOURS, slotIndex, type Employee } from '../src/core/types'

describe('dates', () => {
  it('parses real dates and rejects everything else', () => {
    expect(parseIsoDate('1970-01-01')).toBe(0)
    expect(parseIsoDate('2024-02-29')).not.toBeNull()
    for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-9-21', '21/09/2026', '', '2026-09-21T00:00']) {
      expect(parseIsoDate(bad), bad).toBeNull()
    }
  })

  it('finds the Monday of any week, across month and year boundaries', () => {
    expect(mondayOf('2026-09-21')).toBe('2026-09-21') // a Monday
    expect(mondayOf('2026-09-27')).toBe('2026-09-21') // Sunday of that week
    expect(mondayOf('2026-10-01')).toBe('2026-09-28')
    expect(mondayOf('2027-01-01')).toBe('2026-12-28')
    expect(mondayOf('1970-01-01')).toBe('1969-12-29')
  })

  it('indexes days within the week and nothing outside it', () => {
    expect(weekDayIndex('2026-09-21', '2026-09-21')).toBe(0)
    expect(weekDayIndex('2026-09-21', '2026-09-27')).toBe(6)
    expect(weekDayIndex('2026-09-21', '2026-09-28')).toBeNull()
    expect(weekDayIndex('2026-09-21', '2026-09-20')).toBeNull()
    expect(weekDayIndex('2026-12-28', '2027-01-03')).toBe(6)
  })

  it('is unaffected by daylight-saving changes', () => {
    // Europe ends DST 2026-10-25 and the US 2026-11-01; whole UTC days never see either.
    expect(weekDayIndex('2026-10-19', '2026-10-25')).toBe(6)
    expect(weekDayIndex('2026-10-26', '2026-11-01')).toBe(6)
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDays('2026-03-07', 7)).toBe('2026-03-14')
  })

  it('formats week ranges', () => {
    expect(formatWeekRange('2026-09-21')).toBe('21–27 Sep 2026')
    expect(formatWeekRange('2026-09-28')).toBe('28 Sep – 4 Oct 2026')
    expect(formatWeekRange('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027')
  })

  it('reads today from the local calendar', () => {
    expect(todayIso(new Date(2026, 8, 14, 23, 30))).toBe('2026-09-14')
  })
})

describe('resolveWeek', () => {
  const employee = (): Employee => ({
    id: 'ana',
    name: 'Ana',
    maxWeeklyHours: 40,
    targetWeeklyHours: 20,
    availability: new Uint8Array(WEEK_HOURS).fill(Availability.Preferred),
  })

  it('paints time off unavailable and pins pinned, only within each entry', () => {
    const [resolved] = resolveWeek([employee()], '2026-09-21', {
      ana: {
        timeOff: [{ startDate: '2026-09-22', startHour: 9, endDate: '2026-09-22', endHour: 12 }],
        pins: [{ date: '2026-09-24', startHour: 14, endHour: 16 }],
      },
    })
    for (let slot = 0; slot < WEEK_HOURS; slot++) {
      const off = slot >= slotIndex(1, 9) && slot < slotIndex(1, 12)
      const pin = slot >= slotIndex(3, 14) && slot < slotIndex(3, 16)
      expect(resolved.availability[slot]).toBe(off ? Availability.Unavailable : Availability.Preferred)
      expect(resolved.pinned![slot]).toBe(pin ? 1 : 0)
    }
  })

  it('ignores entries dated outside the week', () => {
    const input = employee()
    const [resolved] = resolveWeek([input], '2026-09-21', {
      ana: {
        timeOff: [{ startDate: '2026-09-28', startHour: 0, endDate: '2026-10-02', endHour: 24 }],
        pins: [{ date: '2026-09-20', startHour: 9, endHour: 12 }],
      },
    })
    expect(Array.from(resolved.availability)).toEqual(Array.from(input.availability))
    expect(resolved.pinned).toBeUndefined()
  })

  it('never mutates its inputs', () => {
    const input = employee()
    const before = Array.from(input.availability)
    const exceptions = {
      ana: {
        timeOff: [{ startDate: '2026-09-21', startHour: 0, endDate: '2026-09-21', endHour: 24 }],
        pins: [{ date: '2026-09-22', startHour: 9, endHour: 10 }],
      },
    }
    const [resolved] = resolveWeek([input], '2026-09-21', exceptions)
    expect(Array.from(input.availability)).toEqual(before)
    expect(input.pinned).toBeUndefined()
    expect(resolved).not.toBe(input)
  })

  it('passes employees without entries through untouched', () => {
    const input = employee()
    expect(resolveWeek([input], '2026-09-21', {})[0]).toBe(input)
    const off = { startDate: '2026-09-21', startHour: 0, endDate: '2026-09-21', endHour: 24 }
    expect(resolveWeek([input], null, { ana: { timeOff: [off], pins: [] } })[0]).toBe(input)
  })

  /** Unavailable slots after resolving `span` against the week of 2026-09-21. */
  const offSlots = (span: { startDate: string; startHour: number; endDate: string; endHour: number }) => {
    const [resolved] = resolveWeek([employee()], '2026-09-21', { ana: { timeOff: [span], pins: [] } })
    const slots: number[] = []
    resolved.availability.forEach((v, slot) => v === Availability.Unavailable && slots.push(slot))
    return slots
  }
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)

  it('treats a multi-day span as one continuous block', () => {
    // Mon 2pm through to Wed 11am: the rest of Monday, all of Tuesday, Wednesday morning.
    expect(offSlots({ startDate: '2026-09-21', startHour: 14, endDate: '2026-09-23', endHour: 11 })).toEqual(
      range(slotIndex(0, 14), slotIndex(2, 11)),
    )
  })

  it('clips spans that start before or end after the week', () => {
    expect(offSlots({ startDate: '2026-09-18', startHour: 9, endDate: '2026-09-22', endHour: 10 })).toEqual(
      range(0, slotIndex(1, 10)),
    )
    expect(offSlots({ startDate: '2026-09-27', startHour: 20, endDate: '2026-09-30', endHour: 24 })).toEqual(
      range(slotIndex(6, 20), WEEK_HOURS),
    )
    expect(offSlots({ startDate: '2026-09-14', startHour: 0, endDate: '2026-09-20', endHour: 24 })).toEqual([])
    expect(offSlots({ startDate: '2026-09-28', startHour: 0, endDate: '2026-09-28', endHour: 1 })).toEqual([])
  })
})

describe('time spans', () => {
  const span = (startDate: string, startHour: number, endDate: string, endHour: number) => ({
    startDate,
    startHour,
    endDate,
    endHour,
  })

  it('accepts only real, forward spans', () => {
    expect(spanIsValid(span('2026-09-22', 0, '2026-09-22', 24))).toBe(true)
    expect(spanIsValid(span('2026-09-22', 14, '2026-09-24', 11))).toBe(true)
    expect(spanIsValid(span('2026-09-22', 23, '2026-09-23', 0))).toBe(true)
    expect(spanIsValid(span('2026-09-22', 12, '2026-09-22', 12))).toBe(false)
    expect(spanIsValid(span('2026-09-24', 0, '2026-09-22', 24))).toBe(false)
    expect(spanIsValid(span('2026-09-22', 0, '2026-02-30', 24))).toBe(false)
    expect(spanIsValid(span('2026-09-22', 0, '2026-09-22', 25))).toBe(false)
    expect(spanIsValid(span('2026-09-22', 1.5, '2026-09-22', 3))).toBe(false)
  })

  it('places spans relative to a week, counting any overlap as this week', () => {
    const week = '2026-09-21'
    expect(spanTiming(week, span('2026-09-14', 0, '2026-09-20', 24))).toBe('past')
    expect(spanTiming(week, span('2026-09-20', 22, '2026-09-21', 1))).toBe('thisWeek')
    expect(spanTiming(week, span('2026-09-27', 23, '2026-09-29', 24))).toBe('thisWeek')
    expect(spanTiming(week, span('2026-09-28', 0, '2026-09-28', 5))).toBe('later')
  })

  it('formats every shape', () => {
    expect(formatSpan(span('2026-09-22', 0, '2026-09-22', 24))).toBe('Tue 22 Sep, all day')
    expect(formatSpan(span('2026-09-22', 0, '2026-09-25', 24))).toBe('Tue 22 – Fri 25 Sep, all day')
    expect(formatSpan(span('2026-09-29', 0, '2026-10-02', 24))).toBe('Tue 29 Sep – Fri 2 Oct, all day')
    expect(formatSpan(span('2026-09-22', 9, '2026-09-22', 12))).toBe('Tue 22 Sep, 9am–12pm')
    expect(formatSpan(span('2026-09-22', 14, '2026-09-24', 11))).toBe('Tue 22 Sep 2pm – Thu 24 Sep 11am')
    expect(formatSpan(span('2026-09-22', 18, '2026-09-22', 24))).toBe('Tue 22 Sep, 6pm–12am')
  })
})
