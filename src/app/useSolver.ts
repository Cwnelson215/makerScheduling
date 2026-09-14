import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchReport } from '../core/report'
import type { SearchProgress } from '../core/search/solver'
import type { Schedule } from '../core/types'
import type { SolveRequest, SolveResponse } from '../worker/protocol'
import type { Project } from './project'

export interface SolvedRun {
  /** The project exactly as it was solved. Results render against this, not the live editor. */
  project: Project
  schedules: Schedule[]
  report: SearchReport
}

export type Activity =
  | { kind: 'idle' }
  | { kind: 'running'; mode: 'solve' | 'calibrate'; progress: SearchProgress | null; timeLimitSeconds: number }
  | { kind: 'calibrated'; bestScore: number | null; suggestedThreshold: number | null; report: SearchReport }
  | { kind: 'error'; message: string; problems?: string[] }
  | { kind: 'cancelled' }

/**
 * Owns the solver Web Worker. The search is synchronous and can run for many seconds, so it
 * must never run on the UI thread.
 *
 * Cancelling terminates the worker outright: a synchronous search cannot receive a "stop"
 * message mid-run, so whatever it had found is discarded. The time limit is the graceful way
 * to stop early and keep results.
 */
export function useSolver() {
  const workerRef = useRef<Worker | null>(null)
  const runIdRef = useRef(0)
  const pendingProjectRef = useRef<Project | null>(null)
  const [activity, setActivity] = useState<Activity>({ kind: 'idle' })
  const [result, setResult] = useState<SolvedRun | null>(null)

  const handleMessage = useCallback((event: MessageEvent<SolveResponse>) => {
    const message = event.data
    if (message.runId !== runIdRef.current) return // a run we already abandoned

    switch (message.type) {
      case 'progress':
        setActivity((current) =>
          current.kind === 'running' ? { ...current, progress: message.progress } : current,
        )
        break
      case 'solved':
        setResult({ project: pendingProjectRef.current!, schedules: message.schedules, report: message.report })
        setActivity({ kind: 'idle' })
        break
      case 'calibrated':
        setActivity({
          kind: 'calibrated',
          bestScore: message.bestScore,
          suggestedThreshold: message.suggestedThreshold,
          report: message.report,
        })
        break
      case 'error':
        setActivity({ kind: 'error', message: message.message, problems: message.problems })
        break
    }
  }, [])

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current
    const worker = new Worker(new URL('../worker/solver.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = handleMessage
    worker.onerror = (event) => {
      event.preventDefault()
      workerRef.current?.terminate()
      workerRef.current = null
      setActivity({ kind: 'error', message: event.message || 'The solver worker crashed.' })
    }
    workerRef.current = worker
    return worker
  }, [handleMessage])

  const start = useCallback(
    (mode: 'solve' | 'calibrate', project: Project) => {
      if (workerRef.current && activity.kind === 'running') {
        workerRef.current.terminate()
        workerRef.current = null
      }
      const runId = ++runIdRef.current
      pendingProjectRef.current = project
      setActivity({ kind: 'running', mode, progress: null, timeLimitSeconds: project.search.timeLimitSeconds })
      const request: SolveRequest = { type: mode, runId, project }
      ensureWorker().postMessage(request)
    },
    [activity.kind, ensureWorker],
  )

  const cancel = useCallback(() => {
    runIdRef.current++
    workerRef.current?.terminate()
    workerRef.current = null
    setActivity({ kind: 'cancelled' })
  }, [])

  const dismiss = useCallback(() => setActivity({ kind: 'idle' }), [])

  useEffect(() => () => workerRef.current?.terminate(), [])

  return {
    activity,
    result,
    solve: (project: Project) => start('solve', project),
    calibrate: (project: Project) => start('calibrate', project),
    cancel,
    dismiss,
  }
}
