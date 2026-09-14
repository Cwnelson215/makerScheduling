import { projectToProblem } from '../app/project'
import { ConfigError } from '../core/config'
import { buildRules } from '../core/rules/catalog'
import { calibrate, solve, type SearchProgress } from '../core/search/solver'
import type { SolveRequest, SolveResponse } from './protocol'

/**
 * Runs one request to completion, posting progress along the way and exactly one terminal
 * message (`solved`, `calibrated` or `error`).
 *
 * Kept separate from the worker entry point so it can be tested directly — a real Worker is
 * not available under Vitest.
 */
export function handleRequest(request: SolveRequest, post: (response: SolveResponse) => void): void {
  const { runId, project } = request
  try {
    const { employees, config } = projectToProblem(project)
    const budget = {
      rules: buildRules(project.rules),
      maxMillis: project.search.timeLimitSeconds * 1000,
      maxNodes: project.search.maxNodes ?? Infinity,
      onProgress: (progress: SearchProgress) => post({ type: 'progress', runId, progress }),
    }

    if (request.type === 'calibrate') {
      const { bestScore, suggestedThreshold, report } = calibrate(employees, config, budget)
      post({ type: 'calibrated', runId, bestScore, suggestedThreshold, report })
      return
    }

    const { schedules, report } = solve(employees, config, {
      ...budget,
      threshold: project.threshold,
      maxResults: project.search.maxResults,
      tightenToBest: project.search.tightenToBest,
    })
    post({ type: 'solved', runId, schedules, report })
  } catch (error) {
    post({
      type: 'error',
      runId,
      message: error instanceof Error ? error.message : String(error),
      problems: error instanceof ConfigError ? error.problems : undefined,
    })
  }
}
