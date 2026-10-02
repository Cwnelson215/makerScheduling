import { fmtHourRange } from '../../core/config'
import { DAYS_PER_WEEK } from '../../core/types'
import { personClass } from '../people'

export interface ShiftTableBlock {
  day: number
  startHour: number
  endHour: number
  /** Includes hours the person marked not preferred. */
  notPreferred?: boolean
  /** Covers a pinned shift. */
  pinned?: boolean
}

export interface ShiftTableRow {
  key: string
  name: string
  blocks: ShiftTableBlock[]
  hours: number
  target?: number
  /** Colour slot, from `colorSlots`; rows without one get no swatch. */
  slot?: number
}

/** People down the side, days across the top, shifts in the cells. */
export function ShiftTable({ dayLabels, rows }: { dayLabels: readonly string[]; rows: ShiftTableRow[] }) {
  return (
    <div className="schedule-scroll">
      <table className="schedule-table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            {dayLabels.map((d) => (
              <th scope="col" key={d}>{d}</th>
            ))}
            <th scope="col" className="num">Hours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = row.target === undefined ? 0 : row.hours - row.target
            return (
              <tr key={row.key}>
                <th scope="row">
                  <span className="legend-item">
                    {row.slot !== undefined && <span className={`swatch ${personClass(row.slot)}`} />}
                    {row.name}
                  </span>
                </th>
                {Array.from({ length: DAYS_PER_WEEK }, (_, day) => (
                  <td key={day}>
                    {row.blocks
                      .filter((b) => b.day === day)
                      .sort((a, b) => a.startHour - b.startHour)
                      .map((b) => {
                        const notes = [
                          b.pinned && 'Covers a pinned shift',
                          b.notPreferred && 'Includes hours this employee marked not preferred',
                        ].filter(Boolean)
                        return (
                          <span
                            key={b.startHour}
                            className={`shift-chip${b.notPreferred ? ' has-not-preferred' : ''}${b.pinned ? ' is-pinned' : ''}`}
                            title={notes.length ? notes.join('. ') : undefined}
                          >
                            {fmtHourRange(b.startHour, b.endHour)}
                            {b.pinned && <span className="chip-note"> · pinned</span>}
                          </span>
                        )
                      })}
                  </td>
                ))}
                <td className="num">
                  <div>{row.hours}h</div>
                  {row.target !== undefined && (
                    <div className="hours-target">
                      target {row.target}
                      {delta !== 0 && ` (${delta > 0 ? '+' : ''}${delta})`}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
