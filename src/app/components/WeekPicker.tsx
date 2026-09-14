import { addDays, formatWeekRange, todayIso } from '../../core/calendar'
import { setWeekStart, type Project, type ProjectUpdate } from '../project'
import { Icon } from './ui/Icon'

/** Moves the project between weeks. Shared by Setup and Employees, which both work a week at a time. */
export function WeekPicker({ project, update }: { project: Project; update: ProjectUpdate }) {
  const shift = (days: number) => update((p) => setWeekStart(p, addDays(p.weekStart, days)))
  return (
    <div className="week-picker">
      <div className="btn-group">
        <button type="button" className="btn btn--icon" aria-label="Previous week" onClick={() => shift(-7)}>
          <Icon name="chevronLeft" />
        </button>
        <button type="button" className="btn btn--icon" aria-label="Next week" onClick={() => shift(7)}>
          <Icon name="chevronRight" />
        </button>
      </div>
      <span className="week-range">{formatWeekRange(project.weekStart)}</span>
      <input
        type="date"
        aria-label="Week starting"
        value={project.weekStart}
        onChange={(e) => {
          const date = e.target.value
          update((p) => setWeekStart(p, date))
        }}
      />
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => update((p) => setWeekStart(p, todayIso()))}>
        This week
      </button>
    </div>
  )
}
