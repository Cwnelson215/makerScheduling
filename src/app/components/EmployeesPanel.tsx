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
import { Callout } from './ui/Callout'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'
import { Menu } from './ui/Menu'
import { Segmented } from './ui/Segmented'
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

  const pinning = brush === 'pin' || brush === 'unpin'

  return (
    <div className="split">
      <section className="card roster">
        <header className="card-header">
          <div className="card-heading">
            <h2 className="card-title">Team</h2>
            <p className="card-description">
              {project.employees.length} {project.employees.length === 1 ? 'person' : 'people'}
            </p>
          </div>
          <button type="button" className="btn btn--sm" onClick={add}>
            <Icon name="plus" size={14} /> Add
          </button>
        </header>
        {project.employees.length === 0 ? (
          <p className="empty" style={{ padding: 'var(--s-4)' }}>No employees yet.</p>
        ) : (
          <ul className="roster-list">
            {project.employees.map((e) => (
              <li key={e.id}>
                <button type="button" className="roster-item" aria-current={e.id === selected?.id} onClick={() => select(e.id)}>
                  <span className="avatar" aria-hidden="true">{initials(e.name)}</span>
                  <span className="roster-name">{e.name || 'Unnamed'}</span>
                  <span className="roster-hours">{e.targetWeeklyHours}/{e.maxWeeklyHours}h</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <div className="stack">
          <section className="card">
            <div className="card-body">
              <div className="employee-head">
                <div className="employee-identity">
                  <span className="avatar avatar--lg" aria-hidden="true">{initials(selected.name)}</span>
                  <input
                    type="text"
                    className="employee-name"
                    aria-label="Name"
                    value={selected.name}
                    onChange={(e) => update((p) => updateEmployee(p, selected.id, { name: e.target.value }))}
                  />
                </div>
                <div className="employee-numbers">
                  <NumberField label="Target hours / week" value={selected.targetWeeklyHours} min={0} max={168} onChange={(v) => update((p) => updateEmployee(p, selected.id, { targetWeeklyHours: v }))} />
                  <NumberField label="Max hours / week" value={selected.maxWeeklyHours} min={0} max={168} onChange={(v) => update((p) => updateEmployee(p, selected.id, { maxWeeklyHours: v }))} />
                  <Menu
                    label={`Actions for ${selected.name || 'this employee'}`}
                    trigger={<Icon name="more" />}
                    triggerClassName="btn btn--ghost btn--icon"
                    entries={[
                      { label: 'Duplicate', icon: 'copy', onSelect: duplicate },
                      { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => setConfirmingDelete(true) },
                    ]}
                  />
                </div>
              </div>
              {confirmingDelete && (
                <Callout
                  tone="critical"
                  title={`Delete ${selected.name || 'this employee'}?`}
                  actions={
                    <>
                      <button type="button" className="btn btn--sm btn--danger-solid" onClick={remove}>Delete</button>
                      <button type="button" className="btn btn--sm" onClick={() => setConfirmingDelete(false)}>Keep</button>
                    </>
                  }
                >
                  <p className="hint">Their availability, time off and pins go with them.</p>
                </Callout>
              )}
            </div>
          </section>

          <Card
            title="Availability & pins"
            description="Pick a brush, then click or drag across the grid."
            info={
              <>
                <p>
                  <strong>Usual week</strong> brushes set availability, which repeats every week.
                </p>
                <p>
                  <strong>Pin</strong> and <strong>Unpin</strong> paint shifts they must work on the dates shown. Change week
                  with the arrows to pin another week.
                </p>
                <p>Faded hours are outside operating hours and never get scheduled.</p>
              </>
            }
            actions={<WeekPicker project={project} update={update} />}
          >
            <div className="toolbar">
              <div className="toolbar-group">
                <span className="section-label">Usual week</span>
                <Segmented
                  label="Availability brush"
                  value={pinning ? null : brush}
                  onChange={setBrush}
                  options={LEVELS.map((level) => ({
                    value: level.value,
                    label: (
                      <>
                        <span className={`swatch avail-${level.value}`} /> {level.label}
                      </>
                    ),
                  }))}
                />
              </div>
              <div className="toolbar-group">
                <span className="section-label">This week only</span>
                <Segmented<Brush>
                  label="Pin brush"
                  value={pinning ? brush : null}
                  onChange={setBrush}
                  options={[
                    { value: 'pin', label: (<><span className="swatch avail-2 cell-pinned" /> Pin</>) },
                    { value: 'unpin', label: 'Unpin' },
                  ]}
                />
              </div>
              <div className="toolbar-actions">
                {pinning ? (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => update((p) => clearWeekPins(p, selected.id))}>
                    Clear pins this week
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        update((p) => {
                          const current = p.employees.find((e) => e.id === selected.id)!
                          return updateEmployee(p, selected.id, { availability: paintGrid(current.availability, openSlots(p), brush) })
                        })
                      }
                    >
                      Set open hours to {levelName(brush).toLowerCase()}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
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
          </Card>

          <Card
            title="Time off & pinned shifts"
            description="Tied to dates. Only this week's entries affect results."
            info="Entries for other weeks are kept for when you get there, so vacations can be entered ahead of time."
          >
            {/* Keyed so a half-filled form resets when another employee is selected. */}
            <ExceptionsEditor key={selected.id} project={project} employee={selected} update={update} />
          </Card>
        </div>
      ) : (
        <Card title="No one selected" description="Add an employee to set their hours and availability.">
          <div>
            <button type="button" className="btn btn--primary" onClick={add}>
              <Icon name="plus" size={14} /> Add employee
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}

/** Up to two letters for an avatar: first and last word, or the first two letters of one word. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]
  return letters.toUpperCase()
}
