import { useState } from 'react'
import { formatDayDate, formatSpan, isIsoDate, mondayOf, spanIsValid, weekDayIndex, type TimeSpan } from '../../core/calendar'
import { fmtHour, fmtHourRange } from '../../core/config'
import { HOURS_PER_DAY } from '../../core/types'
import {
  addTimeOff,
  entryTiming,
  removePin,
  removeTimeOff,
  type Project,
  type ProjectEmployee,
  type ProjectUpdate,
} from '../project'

const HOURS = Array.from({ length: HOURS_PER_DAY + 1 }, (_, h) => h)
const TIMING_LABEL = { past: 'past week', later: 'later week', thisWeek: null } as const

interface EditorProps {
  project: Project
  employee: ProjectEmployee
  update: ProjectUpdate
}

/** Time off, entered as a start and an end; and the pins painted on the grid, listed for removal. */
export function ExceptionsEditor(props: EditorProps) {
  return (
    <div className="exceptions">
      <TimeOffEditor {...props} />
      <PinList {...props} />
    </div>
  )
}

function TimeOffEditor({ project, employee, update }: EditorProps) {
  // New time off defaults to the scheduled week's Monday, and to that day's opening hours.
  const opening = (date: string) => {
    const day = isIsoDate(date) ? weekDayIndex(mondayOf(date), date) : null
    return day === null ? null : project.operatingHours[day]
  }

  const [startDate, setStartDate] = useState(project.weekStart)
  const [endDate, setEndDate] = useState(project.weekStart)
  const [allDay, setAllDay] = useState(true)
  const [startHour, setStartHour] = useState(() => opening(project.weekStart)?.startHour ?? 9)
  const [endHour, setEndHour] = useState(() => opening(project.weekStart)?.endHour ?? 17)

  const span: TimeSpan = allDay
    ? { startDate, startHour: 0, endDate, endHour: HOURS_PER_DAY }
    : { startDate, startHour, endDate, endHour }
  const datesOk = isIsoDate(startDate) && isIsoDate(endDate)
  const valid = datesOk && spanIsValid(span)

  const hourSelect = (label: string, value: number, onChange: (h: number) => void, options: number[]) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((h) => (
        <option key={h} value={h}>{h === HOURS_PER_DAY ? 'midnight' : fmtHour(h)}</option>
      ))}
    </select>
  )

  return (
    <div className="stack exception-list">
      <div>
        <h4>Time off</h4>
        <p className="hint">Can run across several days. Overrides availability for that time only.</p>
      </div>

      <div className="span-form">
        <span className="span-label">From</span>
        <input
          type="date"
          aria-label="Time off starts"
          value={startDate}
          onChange={(e) => {
            const date = e.target.value
            setStartDate(date)
            // Keep the end from falling before the start.
            if (isIsoDate(date) && (!isIsoDate(endDate) || endDate < date)) setEndDate(date)
            const win = opening(date)
            if (win) setStartHour(win.startHour)
          }}
        />
        {allDay ? <span /> : hourSelect('Time off starts at', startHour, setStartHour, HOURS.slice(0, HOURS_PER_DAY))}

        <span className="span-label">To</span>
        <input type="date" aria-label="Time off ends" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        {allDay ? <span /> : hourSelect('Time off ends at', endHour, setEndHour, HOURS.slice(1))}
      </div>

      <div className="row">
        <label className="check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>
        <span className="spacer" />
        <button type="button" className="btn" disabled={!valid} onClick={() => update((p) => addTimeOff(p, employee.id, span))}>
          Add time off
        </button>
      </div>
      {datesOk && !valid && <p className="hint">The end must be after the start.</p>}
      {valid && <p className="hint">{formatSpan(span)}</p>}

      {employee.timeOff.length === 0 ? (
        <p className="hint">No time off.</p>
      ) : (
        <ul className="entry-list">
          {employee.timeOff.map((entry) => (
            <Entry
              key={entry.id}
              label={formatSpan(entry)}
              timing={TIMING_LABEL[entryTiming(project, entry)]}
              onRemove={() => update((p) => removeTimeOff(p, employee.id, entry.id))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function PinList({ project, employee, update }: EditorProps) {
  return (
    <div className="stack exception-list">
      <div>
        <h4>Pinned shifts</h4>
        <p className="hint">Paint these on the grid with the Pin brush. They will work at least these hours.</p>
      </div>
      {employee.pins.length === 0 ? (
        <p className="hint">No pinned shifts.</p>
      ) : (
        <ul className="entry-list">
          {employee.pins.map((pin) => (
            <Entry
              key={pin.id}
              label={`${formatDayDate(pin.date)}, ${fmtHourRange(pin.startHour, pin.endHour)}`}
              timing={TIMING_LABEL[entryTiming(project, pin)]}
              onRemove={() => update((p) => removePin(p, employee.id, pin.id))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Entry({ label, timing, onRemove }: { label: string; timing: string | null; onRemove: () => void }) {
  return (
    <li className={`entry${timing ? ' is-elsewhere' : ''}`}>
      <span>{label}</span>
      {timing && <span className="tag">{timing}</span>}
      <span className="spacer" />
      <button type="button" className="btn btn-small" aria-label={`Remove ${label}`} onClick={onRemove}>
        Remove
      </button>
    </li>
  )
}
