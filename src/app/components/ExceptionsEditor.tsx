import { useState } from 'react'
import { isIsoDate, mondayOf, weekDayIndex } from '../../core/calendar'
import { fmtHour, fmtHourRange } from '../../core/config'
import { HOURS_PER_DAY } from '../../core/types'
import {
  addException,
  entryTiming,
  formatEntryDate,
  removeException,
  type ExceptionKind,
  type Project,
  type ProjectEmployee,
  type ProjectUpdate,
} from '../project'

const HOURS = Array.from({ length: HOURS_PER_DAY + 1 }, (_, h) => h)

const COPY: Record<ExceptionKind, { title: string; hint: string; empty: string; add: string }> = {
  timeOff: {
    title: 'Time off',
    hint: 'Overrides availability for that date only.',
    empty: 'No time off.',
    add: 'Add time off',
  },
  pins: {
    title: 'Pinned shifts',
    hint: 'They will work at least these hours. The solver may extend the shift.',
    empty: 'No pinned shifts.',
    add: 'Pin shift',
  },
}

const TIMING_LABEL = { past: 'past week', later: 'later week', thisWeek: null } as const

/** Dated time off and pins for one employee: an add form and a list, per kind. */
export function ExceptionsEditor({ project, employee, update }: { project: Project; employee: ProjectEmployee; update: ProjectUpdate }) {
  return (
    <div className="exceptions">
      <ExceptionList kind="timeOff" project={project} employee={employee} update={update} />
      <ExceptionList kind="pins" project={project} employee={employee} update={update} />
    </div>
  )
}

function ExceptionList({
  kind,
  project,
  employee,
  update,
}: {
  kind: ExceptionKind
  project: Project
  employee: ProjectEmployee
  update: ProjectUpdate
}) {
  const copy = COPY[kind]

  // New entries default to the scheduled week, and to the chosen day's opening hours when it has some.
  const openingFor = (value: string) => {
    const day = isIsoDate(value) ? weekDayIndex(mondayOf(value), value) : null
    return day === null ? null : project.operatingHours[day]
  }

  const [date, setDate] = useState(project.weekStart)
  const [allDay, setAllDay] = useState(kind === 'timeOff')
  const [startHour, setStartHour] = useState(() => openingFor(project.weekStart)?.startHour ?? 9)
  const [endHour, setEndHour] = useState(() => openingFor(project.weekStart)?.endHour ?? 17)

  const whole = kind === 'timeOff' && allDay
  const range = whole ? { startHour: 0, endHour: HOURS_PER_DAY } : { startHour, endHour }
  const valid = isIsoDate(date) && range.startHour < range.endHour

  const add = () => {
    if (!valid) return
    update((p) => addException(p, employee.id, kind, { date, ...range }))
  }

  return (
    <div className="stack exception-list">
      <div>
        <h4>{copy.title}</h4>
        <p className="hint">{copy.hint}</p>
      </div>

      <div className="row exception-form">
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              const win = openingFor(e.target.value)
              if (win) {
                setStartHour(win.startHour)
                setEndHour(win.endHour)
              }
            }}
          />
        </label>
        {kind === 'timeOff' && (
          <label className="check">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All day
          </label>
        )}
        {!whole && (
          <>
            <label className="field">
              <span>From</span>
              <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
                {HOURS.slice(0, HOURS_PER_DAY).map((h) => (
                  <option key={h} value={h}>{fmtHour(h)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Until</span>
              <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
                {HOURS.slice(1).map((h) => (
                  <option key={h} value={h}>{h === HOURS_PER_DAY ? 'midnight' : fmtHour(h)}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="button" className="btn" disabled={!valid} onClick={add}>{copy.add}</button>
      </div>
      {isIsoDate(date) && !valid && <p className="hint">The end must be after the start.</p>}

      {employee[kind].length === 0 ? (
        <p className="hint">{copy.empty}</p>
      ) : (
        <ul className="entry-list">
          {employee[kind].map((entry) => {
            const timing = TIMING_LABEL[entryTiming(project, entry)]
            const hours = entry.startHour === 0 && entry.endHour === HOURS_PER_DAY ? 'all day' : fmtHourRange(entry.startHour, entry.endHour)
            return (
              <li key={entry.id} className={`entry${timing ? ' is-elsewhere' : ''}`}>
                <span>
                  {formatEntryDate(entry.date)}, {hours}
                </span>
                {timing && <span className="tag">{timing}</span>}
                <span className="spacer" />
                <button
                  type="button"
                  className="btn btn-small"
                  aria-label={`Remove ${copy.title.toLowerCase()} ${formatEntryDate(entry.date)}, ${hours}`}
                  onClick={() => update((p) => removeException(p, employee.id, kind, entry.id))}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
