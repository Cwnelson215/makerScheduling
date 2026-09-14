import { describe, expect, it } from 'vitest'
import {
  addDays,
  formatWeekRange,
  mondayOf,
  parseIsoDate,
  resolveWeek,
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
        timeOff: [{ date: '2026-09-22', startHour: 9, endHour: 12 }],
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
        timeOff: [{ date: '2026-09-28', startHour: 0, endHour: 24 }],
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
      ana: { timeOff: [{ date: '2026-09-21', startHour: 0, endHour: 24 }], pins: [{ date: '2026-09-22', startHour: 9, endHour: 10 }] },
    }
    const [resolved] = resolveWeek([input], '2026-09-21', exceptions)
    expect(Array.from(input.availability)).toEqual(before)
    expect(input.pinned).toBeUndefined()
    expect(resolved).not.toBe(input)
  })

  it('passes employees without entries through untouched', () => {
    const input = employee()
    expect(resolveWeek([input], '2026-09-21', {})[0]).toBe(input)
    expect(resolveWeek([input], null, { ana: { timeOff: [{ date: '2026-09-21', startHour: 0, endHour: 24 }], pins: [] } })[0]).toBe(input)
  })
})
