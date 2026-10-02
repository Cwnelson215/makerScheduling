import { addDays, formatDayDate } from '../core/calendar'
import { fmtHourRange } from '../core/config'
import { DAYS_PER_WEEK, HOURS_PER_DAY } from '../core/types'
import { savedRows, type SavedSchedule } from './project'

/**
 * CSV exports of a saved schedule, for spreadsheets.
 *
 * RFC 4180 quoting and CRLF line endings, with a byte-order mark so Excel reads the file as
 * UTF-8 (names with accents otherwise turn to mojibake). Time ranges use a plain hyphen rather
 * than an en dash for the same reason.
 */

const BOM = '﻿'

function cell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(rows: (string | number)[][]): string {
  return BOM + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

const range = (startHour: number, endHour: number) => fmtHourRange(startHour, endHour).replace('–', '-')

/** 24-hour `HH:MM`; the end of the day is written `00:00`. */
const clock = (hour: number) => `${String(hour % HOURS_PER_DAY).padStart(2, '0')}:00`

/** One row per person, one column per day: what gets printed and pinned up. */
export function weekGridCsv(saved: SavedSchedule): string {
  const dates = Array.from({ length: DAYS_PER_WEEK }, (_, day) => addDays(saved.weekStart, day))
  const header = ['Employee', ...dates.map(formatDayDate), 'Total hours']
  const rows = savedRows(saved).map((row) => [
    row.employeeName,
    ...dates.map((date) =>
      row.shifts
        .filter((s) => s.date === date)
        .map((s) => range(s.startHour, s.endHour))
        .join('; '),
    ),
    row.hours,
  ])
  return toCsv([header, ...rows])
}

/** One row per shift, sorted by date then start time: easy to filter, sort and total. */
export function shiftListCsv(saved: SavedSchedule): string {
  const header = ['Employee', 'Date', 'Day', 'Start', 'End', 'Hours']
  const rows = saved.shifts.map((s) => [
    s.employeeName,
    s.date,
    formatDayDate(s.date).slice(0, 3),
    clock(s.startHour),
    clock(s.endHour),
    s.endHour - s.startHour,
  ])
  return toCsv([header, ...rows])
}

/** `small-cafe-schedule-2026-09-21.csv` */
export function scheduleFileName(projectName: string, weekStart: string, kind: 'grid' | 'shifts'): string {
  const base = projectName.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'schedule'
  return `${base}-${kind === 'grid' ? 'schedule' : 'shifts'}-${weekStart}.csv`
}
