import { formatWeekRange } from '../../core/calendar'
import { initials, weekNote } from '../people'
import { excludedFor, newEmployee, setWorking, workingEmployees, type Project, type ProjectUpdate } from '../project'
import type { Route } from '../routes'
import { Callout } from './ui/Callout'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'

interface EmployeesPageProps {
  project: Project
  update: ProjectUpdate
  navigate: (route: Route) => void
  /** Just arrived from "Start next week": prompt for this week's changes. */
  newWeek: boolean
  onDismissNewWeek: () => void
}

/** Step 1: who is on this week's schedule. Everything else about a person is one click away. */
export function EmployeesPage({ project, update, navigate, newWeek, onDismissNewWeek }: EmployeesPageProps) {
  const out = new Set(excludedFor(project, project.weekStart))
  const working = workingEmployees(project).length
  const week = formatWeekRange(project.weekStart)

  const add = () => {
    const employee = newEmployee(project)
    update((p) => ({ ...p, employees: [...p.employees, employee] }))
    navigate({ page: 'employee', id: employee.id, tab: 'details' })
  }

  return (
    <div className="stack">
      {newWeek && (
        <Callout
          tone="good"
          title={`New week: ${week}`}
          actions={<button type="button" className="btn btn--sm" onClick={onDismissNewWeek}>Dismiss</button>}
        >
          <p className="hint">Check who's working and open anyone who has time off, then continue.</p>
        </Callout>
      )}

      <Card
        title={`Who's working ${week}?`}
        description="Untick anyone who isn't on this week's schedule. Open someone to change their details, availability or time off."
        actions={
          <button type="button" className="btn btn--sm" onClick={add}>
            <Icon name="plus" size={14} /> New employee
          </button>
        }
        flush={project.employees.length > 0}
      >
        {project.employees.length === 0 ? (
          <div className="row">
            <p className="hint">No employees yet.</p>
            <button type="button" className="btn btn--primary" onClick={add}>
              <Icon name="plus" size={14} /> Add your first employee
            </button>
          </div>
        ) : (
          <>
            <ul className="people-list">
              {project.employees.map((e) => {
                const isWorking = !out.has(e.id)
                const note = weekNote(project, e)
                return (
                  <li key={e.id} className={`people-row${isWorking ? '' : ' is-out'}`}>
                    <label className="people-check">
                      <input
                        type="checkbox"
                        checked={isWorking}
                        aria-label={`${e.name || 'Unnamed'} is working this week`}
                        onChange={(event) => update((p) => setWorking(p, e.id, event.target.checked))}
                      />
                      <span className="avatar" aria-hidden="true">{initials(e.name)}</span>
                      <span className="people-text">
                        <span className="people-name">{e.name || 'Unnamed'}</span>
                        <span className="people-meta">
                          {isWorking ? `${e.targetWeeklyHours}h target · up to ${e.maxWeeklyHours}h` : 'Not working this week'}
                          {isWorking && note && <span className="people-note"> · {note}</span>}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigate({ page: 'employee', id: e.id, tab: 'details' })}
                    >
                      Open <Icon name="chevronRight" size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="people-summary hint">
              {working} of {project.employees.length} working this week
            </p>
          </>
        )}
      </Card>
    </div>
  )
}
