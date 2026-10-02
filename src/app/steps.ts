import { projectProblems, savedScheduleFor, workingEmployees, type Project } from './project'

export type StepId = 'employees' | 'coverage' | 'generate' | 'schedule'

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'employees', label: 'Employees' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'generate', label: 'Generate' },
  { id: 'schedule', label: 'Schedule' },
]

/** `done` earns a check mark; `attention` flags something that blocks generating. */
export type StepState = 'done' | 'todo' | 'attention'

/**
 * How far along each step is for the week on screen. `freshResults` says whether the solver has
 * results built from the project as it stands now.
 */
export function stepStates(project: Project, freshResults: boolean, problems = projectProblems(project)): Record<StepId, StepState> {
  return {
    employees: workingEmployees(project).length > 0 ? 'done' : 'todo',
    coverage: project.minCoverage.some((n) => n > 0) ? 'done' : 'todo',
    generate: problems.length > 0 ? 'attention' : freshResults ? 'done' : 'todo',
    schedule: savedScheduleFor(project, project.weekStart) ? 'done' : 'todo',
  }
}
