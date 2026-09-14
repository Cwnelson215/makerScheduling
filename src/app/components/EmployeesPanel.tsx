import { useState } from 'react'
import { fmtHour } from '../../core/config'
import { Availability, DAY_NAMES, HOURS_PER_DAY, WEEK_HOURS } from '../../core/types'
import {
  isOpen,
  newEmployee,
  newId,
  openSlots,
  clearWeekPins,
  paintGrid,
  setPinnedHour,
  updateEmployee,
  visibleHours,
  weekDayLabels,
  weekMarks,
  type Project,
  type ProjectUpdate,
} from '../project'
import { ExceptionsEditor } from './ExceptionsEditor'
import { NumberField } from './NumberField'
import { WeekGrid } from './WeekGrid'
import { WeekPicker } from './WeekPicker'

const LEVELS: { value: Availability; label: string }[] = [
  { value: Availability.Preferred, label: 'Preferred' },
  { value: Availability.NotPreferred, label: 'Not preferred' },
  { value: Availability.Unavailable, label: 'Unavailable' },
]

const levelName = (value: number) => LEVELS.find((l) => l.value === value)?.label ?? 'Unavailable'

/** An availability level for the usual week, or a pin brush for the dated week on screen. */
type Brush = Availability | 'pin' | 'unpin'

export function EmployeesPanel({ project, update }: { project: Project; update: ProjectUpdate }) {
  const [selectedId, setSelectedId] = useState<string | null>(project.employees[0]?.id ?? null)
  const [brush, setBrush] = useState<Brush>(Availability.Preferred)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const selected = project.employees.find((e) => e.id === selectedId) ?? project.employees[0] ?? null
  const marks = selected ? weekMarks(project, selected) : null

  const select = (id: string) => {
    setSelectedId(id)
    setConfirmingDelete(false)
  }

  const add = () => {
    const employee = newEmployee(project)
    update((p) => ({ ...p, employees: [...p.employees, employee] }))
    select(employee.id)
  }

  const duplicate = () => {
    if (!selected) return
    const copy = { ...selected, id: newId(), name: `${selected.name} (copy)`, availability: selected.availability.slice() }
    update((p) => ({ ...p, employees: [...p.employees, copy] }))
    select(copy.id)
  }

  const remove = () => {
    if (!selected) return
    const index = project.employees.findIndex((e) => e.id === selected.id)
    const next = project.employees[index + 1] ?? project.employees[index - 1] ?? null
    update((p) => ({ ...p, employees: p.employees.filter((e) => e.id !== selected.id) }))
    setSelectedId(next?.id ?? null)
    setConfirmingDelete(false)
  }

  return (
    <div className="split">
      <aside className="panel stack">
        <div className="row">
          <h2>Employees</h2>
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={add}>Add</button>
        </div>
        {project.employees.length === 0 ? (
          <p className="hint">No employees yet.</p>
        ) : (
          <ul className="employee-list">
            {project.employees.map((e) => (
              <li key={e.id}>
                <button type="button" className="employee-item" aria-current={e.id === selected?.id} onClick={() => select(e.id)}>
                  <span>{e.name || 'Unnamed'}</span>
                  <span className="muted">{e.targetWeeklyHours}/{e.maxWeeklyHours}h</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {selected ? (
        <section className="panel stack">
          <div className="row">
            <label className="field" style={{ flex: '1 1 14rem' }}>
              <span>Name</span>
              <input type="text" value={selected.name} onChange={(e) => update((p) => updateEmployee(p, selected.id, { name: e.target.value }))} />
            </label>
            <NumberField label="Target hours / week" value={selected.targetWeeklyHours} min={0} max={168} onChange={(v) => update((p) => updateEmployee(p, selected.id, { targetWeeklyHours: v }))} />
            <NumberField label="Max hours / week" value={selected.maxWeeklyHours} min={0} max={168} onChange={(v) => update((p) => updateEmployee(p, selected.id, { maxWeeklyHours: v }))} />
          </div>

          <div className="row">
            <button type="button" className="btn" onClick={duplicate}>Duplicate</button>
            {confirmingDelete ? (
              <>
                <button type="button" className="btn btn-danger" onClick={remove}>Confirm delete {selected.name}</button>
                <button type="button" className="btn" onClick={() => setConfirmingDelete(false)}>Keep</button>
              </>
            ) : (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>Delete</button>
            )}
          </div>

          <div>
            <h3>Availability & pins</h3>
            <p className="hint">
              Availability is the usual week: pick a level, then click or drag across the grid. <strong>Pin</strong> and{' '}
              <strong>Unpin</strong> paint shifts they must work on the dates shown, so change week with the arrows to pin
              another week. Faded hours are outside operating hours and never get scheduled.
            </p>
          </div>

          <WeekPicker project={project} update={update} />

          <div className="row">
            {LEVELS.map((level) => (
              <button key={level.value} type="button" className="btn" aria-pressed={brush === level.value} onClick={() => setBrush(level.value)}>
                <span className={`swatch avail-${level.value}`} style={{ marginRight: '0.4rem', verticalAlign: '-0.15rem' }} />
                {level.label}
              </button>
            ))}
            <span className="brush-divider" aria-hidden="true" />
            <button type="button" className="btn" aria-pressed={brush === 'pin'} onClick={() => setBrush('pin')}>
              <span className="swatch avail-2 cell-pinned" style={{ marginRight: '0.4rem', verticalAlign: '-0.15rem' }} />
              Pin
            </button>
            <button type="button" className="btn" aria-pressed={brush === 'unpin'} onClick={() => setBrush('unpin')}>
              Unpin
            </button>
            <span className="spacer" />
            {brush === 'pin' || brush === 'unpin' ? (
              <button type="button" className="btn" onClick={() => update((p) => clearWeekPins(p, selected.id))}>
                Clear pins this week
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    update((p) => {
                      const current = p.employees.find((e) => e.id === selected.id)!
                      return updateEmployee(p, selected.id, { availability: paintGrid(current.availability, openSlots(p), brush) })
                    })
                  }
                >
                  Set all open hours to {levelName(brush).toLowerCase()}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    update((p) =>
                      updateEmployee(p, selected.id, { availability: new Array<number>(WEEK_HOURS).fill(Availability.Unavailable) }),
                    )
                  }
                >
                  Clear
                </button>
              </>
            )}
          </div>

          <WeekGrid
            label={`${selected.name} availability`}
            hours={visibleHours(project)}
            dayLabels={weekDayLabels(project)}
            onPaint={(slot) =>
              update((p) => {
                const current = p.employees.find((e) => e.id === selected.id)
                if (!current) return p
                if (brush === 'pin' || brush === 'unpin') {
                  // A closed hour can never be worked, so a stroke passing over it doesn't pin it.
                  const closed = !isOpen(p, Math.floor(slot / HOURS_PER_DAY), slot % HOURS_PER_DAY)
                  return brush === 'pin' && closed ? p : setPinnedHour(p, selected.id, slot, brush === 'pin')
                }
                return updateEmployee(p, selected.id, { availability: paintGrid(current.availability, [slot], brush) })
              })
            }
            describe={(slot, day, hour) => {
              const value = selected.availability[slot]
              const open = isOpen(project, day, hour)
              const off = marks!.timeOff[slot]
              const pinned = marks!.pinned[slot]
              const notes = [off && 'time off this week', pinned && 'pinned this week', !open && 'closed'].filter(Boolean)
              return {
                className: `avail-${value}${off ? ' cell-timeoff' : ''}${pinned ? ' cell-pinned' : ''}${open ? '' : ' avail-outside'}`,
                title: `${DAY_NAMES[day]} ${fmtHour(hour)}: ${levelName(value)}${notes.length ? ` (${notes.join(', ')})` : ''}`,
              }
            }}
          />

          <div className="legend">
            {LEVELS.map((level) => (
              <span key={level.value} className="legend-item">
                <span className={`swatch avail-${level.value}`} /> {level.label}
              </span>
            ))}
            <span className="legend-item">
              <span className="swatch avail-2 cell-timeoff" /> Time off
            </span>
            <span className="legend-item">
              <span className="swatch avail-2 cell-pinned" /> Pinned
            </span>
          </div>

          <div>
            <h3>Time off & pinned shifts</h3>
            <p className="hint">
              Tied to dates. Only entries in the week being scheduled affect results; entries for other weeks are kept for
              when you get there.
            </p>
          </div>
          {/* Keyed so a half-filled form resets when another employee is selected. */}
          <ExceptionsEditor key={selected.id} project={project} employee={selected} update={update} />
        </section>
      ) : (
        <section className="panel">
          <p className="hint">Add an employee to set their hours and availability.</p>
        </section>
      )}
    </div>
  )
}
