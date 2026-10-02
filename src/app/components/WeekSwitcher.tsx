import { useRef } from 'react'
import { addDays, formatWeekRange, mondayOf, todayIso } from '../../core/calendar'
import { savedScheduleFor, setWeekStart, type Project, type ProjectUpdate } from '../project'
import { Icon } from './ui/Icon'

/**
 * The week everything is about. Time off and pins are entered against it, schedules are built
 * for it, and a saved schedule belongs to it — so it lives in the top bar, once.
 */
export function WeekSwitcher({ project, update }: { project: Project; update: ProjectUpdate }) {
  const picker = useRef<HTMLInputElement>(null)
  const thisWeek = mondayOf(todayIso())
  const shift = (days: number) => update((p) => setWeekStart(p, addDays(p.weekStart, days)))
  const saved = savedScheduleFor(project, project.weekStart) !== null

  const openPicker = () => {
    const input = picker.current
    if (!input) return
    try {
      input.showPicker()
    } catch {
      input.focus()
    }
  }

  return (
    <div className="week-switcher">
      <div className="week-switcher-control">
        <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Previous week" onClick={() => shift(-7)}>
          <Icon name="chevronLeft" />
        </button>
        <button type="button" className="week-switcher-range" onClick={openPicker} title="Pick a week">
          <Icon name="calendar" size={14} />
          <span>Week of {formatWeekRange(project.weekStart)}</span>
        </button>
        <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Next week" onClick={() => shift(7)}>
          <Icon name="chevronRight" />
        </button>
        <input
          ref={picker}
          type="date"
          className="week-switcher-input"
          tabIndex={-1}
          aria-label="Week starting"
          value={project.weekStart}
          onChange={(e) => {
            const date = e.target.value
            update((p) => setWeekStart(p, date))
          }}
        />
      </div>
      {project.weekStart < thisWeek ? (
        <button type="button" className="pill pill--warning pill--button" onClick={() => update((p) => setWeekStart(p, thisWeek))}>
          Past week · go to this week
        </button>
      ) : saved ? (
        <span className="pill pill--good">
          <Icon name="check" size={12} /> Schedule saved
        </span>
      ) : (
        <span className="pill">Not scheduled yet</span>
      )}
    </div>
  )
}
