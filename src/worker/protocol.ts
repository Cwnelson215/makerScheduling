import type { Project } from '../app/project'
import type { SearchReport } from '../core/report'
import type { SearchProgress } from '../core/search/solver'
import type { Schedule } from '../core/types'

/**
 * Messages between the UI thread and the solver worker. Everything here must survive
 * structured cloning, which is why requests carry a plain {@link Project} rather than rule
 * objects — the worker rebuilds rules from settings on its side.
 *
 * `runId` lets the UI ignore late messages from a run it has already abandoned.
 */
export type SolveRequest =
  | { type: 'solve'; runId: number; project: Project }
  | { type: 'calibrate'; runId: number; project: Project }

export type SolveResponse =
  | { type: 'progress'; runId: number; progress: SearchProgress }
  | { type: 'solved'; runId: number; schedules: Schedule[]; report: SearchReport }
  | {
      type: 'calibrated'
      runId: number
      bestScore: number | null
      suggestedThreshold: number | null
      report: SearchReport
    }
  | { type: 'error'; runId: number; message: string; problems?: string[] }
