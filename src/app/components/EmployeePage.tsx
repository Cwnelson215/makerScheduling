import { useState } from 'react'
import { formatWeekRange } from '../../core/calendar'
import { fmtHour } from '../../core/config'
import { Availability, DAY_NAMES, HOURS_PER_DAY, WEEK_HOURS } from '../../core/types'
import { initials } from '../people'
import {
  clearWeekPins,
  excludedFor,
  isOpen,
  newId,
  openSlots,
  paintGrid,
  setPinnedHour,
  setWorking,
  updateEmployee,
  visibleHours,
  weekDayLabels,
  weekMarks,
  type Project,
  type ProjectEmployee,
  type ProjectUpdate,
} from '../project'
import type { EmployeeTab, Route } from '../routes'
import { PinList, TimeOffEditor } from './ExceptionsEditor'
import { NumberField } from './NumberField'
import { Callout } from './ui/Callout'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'
import { Segmented } from './ui/Segmented'
import { WeekGrid } from './WeekGrid'

const LEVELS: { value: Availability; label: string }[] = [
  { value: Availability.Preferred, label: 'Preferred' },
  { value: Availability.NotPreferred, label: 'Not preferred' },
  { value: Availability.Unavailable, label: 'Unavailable' },
]

const levelName = (value: number) => LEVELS.find((l) => l.value === value)?.label ?? 'Unavailable'

const TABS: { id: EmployeeTab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'availability', label: 'Usual availability' },
  { id: 'time-off', label: 'Time off & pins' },
]

interface EmployeePageProps {
  project: Project
  update: ProjectUpdate
  navigate: (route: Route) => void
  id: string
  tab: EmployeeTab
}

/** One person, one concern at a time: details, their usual week, or this week's exceptions. */
export function EmployeePage({ project, update, navigate, id, tab }: EmployeePageProps) {
  const employee = project.employees.find((e) => e.id === id)
  const back = () => navigate({ page: 'employees' })

  if (!employee) {
    return (
      <Card title="Employee not found" description="They may have been deleted.">
        <div>
          <button type="button" className="btn" onClick={back}>
            <Icon name="arrowLeft" size={14} /> All employees
          </button>
        </div>
      </Card>
    )
  }

  const working = !excludedFor(project, project.weekStart).includes(employee.id)

  return (
    <div className="stack">
      <div className="page-head">
        <button type="button" className="btn btn--ghost btn--sm back-link" onClick={back}>
          <Icon name="arrowLeft" size={14} /> All employees
        </button>
        <div className="page-title-row">
          <span className="avatar avatar--lg" aria-hidden="true">{initials(employee.name)}</span>
          <h1 className="page-title">{employee.name || 'Unnamed'}</h1>
          {!working && <span className="pill">Not working this week</span>}
        </div>
        <nav className="subtabs" aria-label={`${employee.name} sections`}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="subtab"
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => navigate({ page: 'employee', id: employee.id, tab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Keyed so a half-filled form resets when another employee is opened. */}
      {tab === 'details' && <DetailsTab key={employee.id} project={project} update={update} employee={employee} working={working} navigate={navigate} />}
      {tab === 'availability' && <AvailabilityTab project={project} update={update} employee={employee} />}
      {tab === 'time-off' && <TimeOffTab key={employee.id} project={project} update={update} employee={employee} />}
    </div>
  )
}

interface TabProps {
  project: Project
  update: ProjectUpdate
  employee: ProjectEmployee
}

function DetailsTab({ project, update, employee, working, navigate }: TabProps & { working: boolean; navigate: (route: Route) => void }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const duplicate = () => {
    const copy = { ...employee, id: newId(), name: `${employee.name} (copy)`, availability: employee.availability.slice() }
    update((p) => ({ ...p, employees: [...p.employees, copy] }))
    navigate({ page: 'employee', id: copy.id, tab: 'details' })
  }

  const remove = () => {
    update((p) => ({ ...p, employees: p.employees.filter((e) => e.id !== employee.id) }))
    navigate({ page: 'employees' })
  }

  return (
    <>
      <Card title="Details">
        <label className="field">
          <span>Name</span>
          <input type="text" value={employee.name} onChange={(e) => update((p) => updateEmployee(p, employee.id, { name: e.target.value }))} />
        </label>
        <div className="fields">
          <NumberField label="Target hours / week" value={employee.targetWeeklyHours} min={0} max={168} onChange={(v) => update((p) => updateEmployee(p, employee.id, { targetWeeklyHours: v }))} />
          <NumberField label="Max hours / week" value={employee.maxWeeklyHours} min={0} max={168} onChange={(v) => update((p) => updateEmployee(p, employee.id, { maxWeeklyHours: v }))} />
        </div>
        <label className="toggle">
          <input type="checkbox" role="switch" className="switch" checked={working} onChange={(e) => update((p) => setWorking(p, employee.id, e.target.checked))} />
          <span className="toggle-text">
            <span className="toggle-label">Working the week of {formatWeekRange(project.weekStart)}</span>
            <span className="toggle-hint">Carries over to the following weeks until you change it.</span>
          </span>
        </label>
      </Card>

      <Card title="Other actions">
        <div className="row">
          <button type="button" className="btn" onClick={duplicate}>
            <Icon name="copy" size={14} /> Duplicate
          </button>
          <button type="button" className="btn btn--danger" onClick={() => setConfirmingDelete(true)}>
            <Icon name="trash" size={14} /> Delete…
          </button>
        </div>
        {confirmingDelete && (
          <Callout
            tone="critical"
            title={`Delete ${employee.name || 'this employee'}?`}
            actions={
              <>
                <button type="button" className="btn btn--sm btn--danger-solid" onClick={remove}>Delete</button>
                <button type="button" className="btn btn--sm" onClick={() => setConfirmingDelete(false)}>Keep</button>
              </>
            }
          >
            <p className="hint">Their availability, time off and pins go with them. Saved schedules keep their name. You can undo this.</p>
          </Callout>
        )}
      </Card>
    </>
  )
}

function AvailabilityTab({ project, update, employee }: TabProps) {
  const [brush, setBrush] = useState<Availability>(Availability.Preferred)
  const paint = (slots: Iterable<number>, value: number) =>
    update((p) => {
      const current = p.employees.find((e) => e.id === employee.id)
      return current ? updateEmployee(p, employee.id, { availability: paintGrid(current.availability, slots, value) }) : p
    })

  return (
    <Card
      title="Usual availability"
      description="When they can work in a normal week. Pick a brush, then click or drag across the grid."
      info="This repeats every week. For one-off changes, use Time off & pins. Faded hours are outside your opening hours and never get scheduled."
    >
      <div className="toolbar">
        <Segmented
          label="Availability brush"
          value={brush}
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
        <div className="toolbar-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => update((p) => {
            const current = p.employees.find((e) => e.id === employee.id)
            return current ? updateEmployee(p, employee.id, { availability: paintGrid(current.availability, openSlots(p), brush) }) : p
          })}>
            Set open hours to {levelName(brush).toLowerCase()}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => update((p) => updateEmployee(p, employee.id, { availability: new Array<number>(WEEK_HOURS).fill(Availability.Unavailable) }))}
          >
            Clear
          </button>
        </div>
      </div>

      <WeekGrid
        label={`${employee.name} usual availability`}
        hours={visibleHours(project)}
        onPaint={(slot) => paint([slot], brush)}
        describe={(slot, day, hour) => {
          const value = employee.availability[slot]
          const open = isOpen(project, day, hour)
          return {
            className: `avail-${value}${open ? '' : ' avail-outside'}`,
            title: `${DAY_NAMES[day]} ${fmtHour(hour)}: ${levelName(value)}${open ? '' : ' (closed)'}`,
          }
        }}
      />

      <div className="legend">
        {LEVELS.map((level) => (
          <span key={level.value} className="legend-item">
            <span className={`swatch avail-${level.value}`} /> {level.label}
          </span>
        ))}
      </div>
    </Card>
  )
}

function TimeOffTab({ project, update, employee }: TabProps) {
  const [pinning, setPinning] = useState<'pin' | 'unpin'>('pin')
  const marks = weekMarks(project, employee)

  return (
    <>
      <Card
        title="Time off"
        description="Can run across several days. They won't be scheduled during it."
        info="Tied to dates: only entries in the week being scheduled affect it. Entries for other weeks are kept, so vacations can go in ahead of time."
      >
        <TimeOffEditor project={project} employee={employee} update={update} />
      </Card>

      <Card
        title={`Must-work shifts for ${formatWeekRange(project.weekStart)}`}
        description="Paint hours they must work this week. They'll work at least these hours."
        info="Pins belong to the dates shown. Use the week switcher at the top to pin another week."
      >
        <div className="toolbar">
          <Segmented
            label="Pin brush"
            value={pinning}
            onChange={setPinning}
            options={[
              { value: 'pin', label: (<><span className="swatch avail-2 cell-pinned" /> Pin</>) },
              { value: 'unpin', label: 'Unpin' },
            ]}
          />
          <div className="toolbar-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => update((p) => clearWeekPins(p, employee.id))}>
              Clear pins this week
            </button>
          </div>
        </div>

        <WeekGrid
          label={`${employee.name} pins this week`}
          hours={visibleHours(project)}
          dayLabels={weekDayLabels(project)}
          onPaint={(slot) =>
            update((p) => {
              // A closed hour can never be worked, so a stroke passing over it doesn't pin it.
              const closed = !isOpen(p, Math.floor(slot / HOURS_PER_DAY), slot % HOURS_PER_DAY)
              return pinning === 'pin' && closed ? p : setPinnedHour(p, employee.id, slot, pinning === 'pin')
            })
          }
          describe={(slot, day, hour) => {
            const value = employee.availability[slot]
            const open = isOpen(project, day, hour)
            const off = marks.timeOff[slot]
            const pinned = marks.pinned[slot]
            const notes = [off && 'time off', pinned && 'pinned', !open && 'closed'].filter(Boolean)
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

        <PinList project={project} employee={employee} update={update} />
      </Card>
    </>
  )
}
