import type { CSSProperties } from 'react'
import { fmtHour, fmtHourRange } from '../../core/config'
import { DAYS_PER_WEEK } from '../../core/types'
import { personClass } from '../people'
import type { ShiftTableRow } from './ShiftTable'

/** The hours the axis spans: `hours` if given, widened to take in every shift. */
function axisRange(rows: ShiftTableRow[], hours?: { from: number; to: number }): { from: number; to: number } {
  let from = hours?.from ?? Infinity
  let to = hours?.to ?? -Infinity
  for (const row of rows) {
    for (const block of row.blocks) {
      from = Math.min(from, block.startHour)
      to = Math.max(to, block.endHour)
    }
  }
  return from < to ? { from, to } : { from: 8, to: 18 }
}

interface ShiftTimelineProps {
  dayLabels: readonly string[]
  rows: ShiftTableRow[]
  /** Hours to show; defaults to the span of the shifts themselves. */
  hours?: { from: number; to: number }
}

/**
 * Days down the side, hours across the top, one bar per shift in its person's colour, so who is
 * on at any hour reads straight down from the axis. A day only has lanes for the people working it.
 */
export function ShiftTimeline({ dayLabels, rows, hours }: ShiftTimelineProps) {
  const { from, to } = axisRange(rows, hours)
  const span = to - from
  const tickEvery = span > 14 ? 2 : 1
  const column = (hour: number) => hour - from + 1

  return (
    <div className="stack-sm">
      <div className="legend">
        {rows.map((row) => (
          <span key={row.key} className="legend-item">
            <span className={`swatch ${personClass(row.slot ?? 0)}`} /> {row.name}
            <span className="legend-note">{row.hours}h</span>
          </span>
        ))}
      </div>
      <div className="schedule-scroll">
        <div className="timeline" style={{ '--hours': span } as CSSProperties}>
          <div className="timeline-row timeline-head" aria-hidden="true">
            <div />
            <div className="timeline-track">
              {Array.from({ length: span }, (_, i) => i)
                .filter((i) => i % tickEvery === 0)
                .map((i) => (
                  <span key={i} className="timeline-tick" style={{ gridColumn: i + 1 }}>
                    {fmtHour(from + i)}
                  </span>
                ))}
            </div>
          </div>
          {Array.from({ length: DAYS_PER_WEEK }, (_, day) => {
            const lanes = rows
              .map((row) => ({ row, blocks: row.blocks.filter((b) => b.day === day) }))
              .filter((lane) => lane.blocks.length > 0)
            return (
              <div className="timeline-row" key={day}>
                <div className="timeline-day">{dayLabels[day]}</div>
                <div className="timeline-track">
                  {lanes.length === 0 && <span className="timeline-empty">No shifts</span>}
                  {lanes.map(({ row, blocks }, lane) =>
                    blocks.map((b) => {
                      const range = fmtHourRange(b.startHour, b.endHour)
                      const notes = [
                        `${row.name}, ${dayLabels[day]}, ${range} (${b.endHour - b.startHour}h)`,
                        b.pinned && 'Covers a pinned shift',
                        b.notPreferred && 'Includes hours this employee marked not preferred',
                      ].filter(Boolean)
                      return (
                        <span
                          key={`${row.key}-${b.startHour}`}
                          className={`timeline-bar ${personClass(row.slot ?? 0)}${b.notPreferred ? ' has-not-preferred' : ''}${b.pinned ? ' is-pinned' : ''}`}
                          style={{ gridColumn: `${column(b.startHour)} / ${column(b.endHour)}`, gridRow: lane + 1 }}
                          title={notes.join('. ')}
                        >
                          <span className="timeline-name">{row.name}</span> {range}
                        </span>
                      )
                    }),
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
