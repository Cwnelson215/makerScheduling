import { addDays, formatWeekRange, todayIso } from '../../core/calendar'
import { setWeekStart, type Project, type ProjectUpdate } from '../project'

/** Moves the project between weeks. Shared by Setup and Employees, which both work a week at a time. */
export function WeekPicker({ project, update }: { project: Project; update: ProjectUpdate }) {
  const shift = (days: number) => update((p) => setWeekStart(p, addDays(p.weekStart, days)))
  return (
    <div className="row week-picker">
      <button type="button" className="btn" aria-label="Previous week" onClick={() => shift(-7)}>
        ‹
      </button>
      <input
        type="date"
        aria-label="Week starting"
        value={project.weekStart}
        onChange={(e) => {
          const date = e.target.value
          update((p) => setWeekStart(p, date))
        }}
      />
      <button type="button" className="btn" aria-label="Next week" onClick={() => shift(7)}>
        ›
      </button>
      <strong>{formatWeekRange(project.weekStart)}</strong>
      <button type="button" className="btn" onClick={() => update((p) => setWeekStart(p, todayIso()))}>
        This week
      </button>
    </div>
  )
}
