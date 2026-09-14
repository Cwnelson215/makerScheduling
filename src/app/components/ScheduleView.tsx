import { fmtHour } from '../../core/config'
import { catalogEntry } from '../../core/rules/catalog'
import { Availability, DAY_NAMES, WEEK_HOURS, slotIndex, type Schedule, type ShiftBlock } from '../../core/types'
import { isOpen, visibleHours, type Project } from '../project'
import { WeekGrid } from './WeekGrid'

/** `fmtHour` treats 24 as noon; a shift ending at 24 ends at midnight. */
const clock = (hour: number) => (hour === 24 ? '12am' : fmtHour(hour))

function touchesNotPreferred(block: ShiftBlock, availability: number[]): boolean {
  for (let hour = block.startHour; hour < block.endHour; hour++) {
    if (availability[slotIndex(block.day, hour)] === Availability.NotPreferred) return true
  }
  return false
}

/**
 * One schedule, rendered against the project *as it was solved*, so editing the roster
 * afterwards can't make the result display nonsense (e.g. a deleted employee's shifts landing
 * on whoever now sits at that index).
 */
export function ScheduleView({ schedule, project }: { schedule: Schedule; project: Project }) {
  const staffed = new Array<number>(WEEK_HOURS).fill(0)
  for (const blocks of schedule.blocks) {
    for (const block of blocks) {
      for (let hour = block.startHour; hour < block.endHour; hour++) staffed[slotIndex(block.day, hour)]++
    }
  }

  const charged = project.rules
    .filter((r) => r.enabled)
    .map((r) => ({ id: r.id, label: catalogEntry(r.id).label, value: schedule.penalties[r.id] ?? 0 }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value)
  const largest = charged[0]?.value ?? 0

  return (
    <div className="stack">
      <div className="table-scroll">
        <table className="schedule-table">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              {DAY_NAMES.map((d) => (
                <th scope="col" key={d}>{d}</th>
              ))}
              <th scope="col" className="num">Hours</th>
            </tr>
          </thead>
          <tbody>
            {project.employees.map((employee, e) => {
              const hours = schedule.hoursPerEmployee[e]
              const delta = hours - employee.targetWeeklyHours
              return (
                <tr key={employee.id}>
                  <th scope="row" style={{ fontWeight: 600 }}>{employee.name}</th>
                  {DAY_NAMES.map((d, day) => (
                    <td key={d}>
                      {schedule.blocks[e]
                        .filter((b) => b.day === day)
                        .map((b) => {
                          const flagged = touchesNotPreferred(b, employee.availability)
                          return (
                            <span
                              key={b.startHour}
                              className={`shift-chip${flagged ? ' has-not-preferred' : ''}`}
                              title={flagged ? 'Includes hours this employee marked not preferred' : undefined}
                            >
                              {clock(b.startHour)}–{clock(b.endHour)}
                            </span>
                          )
                        })}
                    </td>
                  ))}
                  <td className="num">
                    <div>{hours}h</div>
                    <div className="hint">
                      target {employee.targetWeeklyHours}
                      {delta !== 0 && ` (${delta > 0 ? '+' : ''}${delta})`}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Dashed shifts include hours the employee marked not preferred.</p>

      <div className="stack" style={{ gap: '0.5rem' }}>
        <h3>Where the points went</h3>
        {charged.length === 0 ? (
          <p className="hint">No penalties. This schedule scores a perfect 100.</p>
        ) : (
          <div className="penalties">
            {charged.map((p) => (
              <div key={p.id} className="penalty-row">
                <span>{p.label}</span>
                <div className="penalty-bar" aria-hidden="true">
                  <div style={{ width: `${(p.value / largest) * 100}%` }} />
                </div>
                <span className="penalty-value">−{Number(p.value.toFixed(2))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: '0.5rem' }}>
        <h3>Staffing by hour</h3>
        <WeekGrid
          label="People on shift each hour"
          hours={visibleHours(project)}
          describe={(slot, day, hour) => {
            const when = `${DAY_NAMES[day]} ${fmtHour(hour)}`
            const count = staffed[slot]
            const need = project.minCoverage[slot]
            if (!isOpen(project, day, hour)) return { className: 'cell-closed', title: `${when}: closed`, text: count ? String(count) : undefined }
            if (count < need) return { className: 'cell-short', text: String(count), title: `${when}: ${count} on shift, ${need} required (short)` }
            const extra = count - need
            return {
              className: `seq-${Math.min(extra, 6)}`,
              text: String(count),
              title: `${when}: ${count} on shift, ${need} required${extra ? ` (+${extra} extra)` : ''}`,
            }
          }}
        />
        <div className="legend">
          <span className="legend-item">Number = people on shift. Shade = people beyond the minimum:</span>
          {[0, 1, 2, 3].map((n) => (
            <span key={n} className="legend-item">
              <span className={`swatch seq-${n}`} /> {n === 0 ? 'at minimum' : n === 3 ? '+3 or more' : `+${n}`}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
