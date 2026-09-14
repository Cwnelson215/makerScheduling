import { useMemo, useState } from 'react'
import type { SearchReport } from '../../core/report'
import type { Project, ProjectUpdate } from '../project'
import type { SolvedRun, useSolver } from '../useSolver'
import { NumberField } from './NumberField'
import { ScheduleView } from './ScheduleView'

const n = (x: number) => x.toLocaleString()
const score = (x: number) => String(Number(x.toFixed(2)))

/** The parts of a project that change which schedules are valid or how they score. */
const solveInputs = (p: Project) =>
  JSON.stringify([p.operatingHours, p.minCoverage, p.shiftRules, p.employees, p.rules, p.threshold])

function stopDescription(report: SearchReport): string {
  switch (report.stopReason) {
    case 'timeBudget':
      return 'the time limit'
    case 'nodeBudget':
      return 'the node limit'
    default:
      return 'an early stop'
  }
}

interface SolvePanelProps {
  project: Project
  update: ProjectUpdate
  solver: ReturnType<typeof useSolver>
  problems: string[]
}

export function SolvePanel({ project, update, solver, problems }: SolvePanelProps) {
  const { activity, result } = solver
  const running = activity.kind === 'running'
  const blocked = problems.length > 0
  const search = project.search

  const setSearch = (patch: Partial<Project['search']>) => update((p) => ({ ...p, search: { ...p.search, ...patch } }))

  return (
    <div className="stack">
      <section className="panel stack">
        <h2>Build schedules</h2>
        <div className="fields">
          <NumberField
            label="Keep schedules scoring at least"
            value={project.threshold}
            integer={false}
            step={1}
            onChange={(v) => update((p) => ({ ...p, threshold: v }))}
          />
          <NumberField label="Time limit (seconds)" value={search.timeLimitSeconds} min={1} max={600} onChange={(v) => setSearch({ timeLimitSeconds: v })} />
          <NumberField label="Schedules to keep" value={search.maxResults} min={1} max={1000} onChange={(v) => setSearch({ maxResults: v })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={search.maxNodes !== null} onChange={(e) => setSearch({ maxNodes: e.target.checked ? 5_000_000 : null })} />
          Also cap the number of search steps
        </label>
        {search.maxNodes !== null && (
          <div className="fields">
            <NumberField label="Search step limit" value={search.maxNodes} min={1000} step={100000} onChange={(v) => setSearch({ maxNodes: v })} />
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={search.tightenToBest} onChange={(e) => setSearch({ tightenToBest: e.target.checked })} />
          Focus on the best schedules only
        </label>
        <p className="hint" style={{ marginTop: '-0.5rem' }}>
          Much faster on large rosters. Once enough schedules are kept, it skips anything that can't beat the weakest of
          them, so you get the best ones rather than every schedule above the threshold.
        </p>

        {blocked && (
          <div className="notice notice-critical" role="alert">
            <div className="notice-title">Fix these before building schedules</div>
            <ul>
              {problems.slice(0, 8).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            {problems.length > 8 && <p className="hint">…and {problems.length - 8} more.</p>}
          </div>
        )}

        <div className="row">
          {running ? (
            <>
              <button type="button" className="btn btn-danger" onClick={solver.cancel}>Stop</button>
              <span className="hint">Stopping throws away this run. To stop sooner and keep results, lower the time limit.</span>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary" disabled={blocked} onClick={() => solver.solve(project)}>
                Build schedules
              </button>
              <button type="button" className="btn" disabled={blocked} onClick={() => solver.calibrate(project)}>
                Find achievable score
              </button>
            </>
          )}
        </div>

        <ActivityView activity={activity} onDismiss={solver.dismiss} onUseThreshold={(t) => update((p) => ({ ...p, threshold: t }))} />
      </section>

      {result && <ResultSection run={result} project={project} />}
    </div>
  )
}

function ActivityView({
  activity,
  onDismiss,
  onUseThreshold,
}: {
  activity: ReturnType<typeof useSolver>['activity']
  onDismiss: () => void
  onUseThreshold: (threshold: number) => void
}) {
  switch (activity.kind) {
    case 'idle':
      return null
    case 'running': {
      const p = activity.progress
      const elapsed = p ? p.elapsedMs / 1000 : 0
      return (
        <div className="stack" style={{ gap: '0.5rem' }} aria-live="polite">
          <div className="notice-title">
            {activity.mode === 'calibrate' ? 'Finding the best achievable score…' : 'Searching…'}
          </div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={activity.timeLimitSeconds} aria-valuenow={Math.round(elapsed)}>
            <div style={{ width: `${Math.min(100, (elapsed / activity.timeLimitSeconds) * 100)}%` }} />
          </div>
          <div className="stats">
            <Stat label="Elapsed" value={`${elapsed.toFixed(1)}s of ${activity.timeLimitSeconds}s`} />
            <Stat label="Search steps" value={p ? n(p.nodesExplored) : '—'} />
            <Stat label="Schedules found" value={p ? n(p.schedulesFound) : '—'} />
            <Stat label="Best score" value={p?.bestScore != null ? score(p.bestScore) : '—'} />
          </div>
        </div>
      )
    }
    case 'calibrated': {
      const { bestScore, suggestedThreshold, report } = activity
      if (bestScore === null) {
        return (
          <div className="notice notice-warning">
            <div className="notice-title">No complete schedule found within the limit</div>
            <p className="hint">The roster may be impossible to staff, or it needs more time. Try raising the time limit.</p>
            <button type="button" className="btn" style={{ marginTop: '0.5rem' }} onClick={onDismiss}>Dismiss</button>
          </div>
        )
      }
      return (
        <div className={`notice ${report.complete ? 'notice-good' : 'notice-warning'}`}>
          <div className="notice-title">Best achievable score: {score(bestScore)}</div>
          <p className="hint">
            {report.complete
              ? 'This is the true best. The search finished.'
              : `The search stopped at ${stopDescription(report)}, so a higher score may exist.`}{' '}
            A threshold of {suggestedThreshold} keeps a band of good schedules rather than only the single best.
          </p>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-primary" onClick={() => { onUseThreshold(suggestedThreshold!); onDismiss() }}>
              Use {suggestedThreshold} as threshold
            </button>
            <button type="button" className="btn" onClick={onDismiss}>Dismiss</button>
          </div>
        </div>
      )
    }
    case 'error':
      return (
        <div className="notice notice-critical" role="alert">
          <div className="notice-title">The solver couldn't run</div>
          {activity.problems ? (
            <ul>{activity.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          ) : (
            <p>{activity.message}</p>
          )}
          <button type="button" className="btn" style={{ marginTop: '0.5rem' }} onClick={onDismiss}>Dismiss</button>
        </div>
      )
    case 'cancelled':
      return (
        <div className="notice notice-warning">
          <div className="notice-title">Stopped. Nothing from that run was kept.</div>
          <button type="button" className="btn" style={{ marginTop: '0.5rem' }} onClick={onDismiss}>Dismiss</button>
        </div>
      )
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  )
}

function ResultSection({ run, project }: { run: SolvedRun; project: Project }) {
  const [selection, setSelection] = useState<{ run: SolvedRun; index: number } | null>(null)
  const index = selection?.run === run ? selection.index : 0
  const { report, schedules } = run
  const stale = useMemo(() => solveInputs(run.project) !== solveInputs(project), [run.project, project])
  const threshold = score(report.threshold)

  let summary: { tone: string; title: string; detail: string }
  if (!report.complete) {
    summary = {
      tone: 'notice-warning',
      title: `Stopped at ${stopDescription(report)}`,
      detail:
        schedules.length > 0
          ? 'These are the schedules found so far. Better ones may exist in the part of the search that was not reached.'
          : `No schedule scoring ${threshold} or more turned up before the limit. Try a longer time limit, a lower threshold, or "Focus on the best schedules only".`,
    }
  } else if (schedules.length === 0) {
    summary = {
      tone: 'notice-warning',
      title: `No schedule can score ${threshold} or more`,
      detail: 'The search finished, so this is certain. Lower the threshold or ease the rules.',
    }
  } else if (report.provenScope === 'top-k') {
    summary = {
      tone: 'notice-good',
      title: `These are the ${n(schedules.length)} best schedules`,
      detail: 'The search finished. Because it focused on the best only, this is not every schedule above the threshold.',
    }
  } else {
    summary = {
      tone: 'notice-good',
      title: `Every schedule scoring ${threshold} or more was found`,
      detail: 'The search finished, so nothing that qualifies was missed.',
    }
  }

  return (
    <section className="panel stack">
      <div className="row">
        <h2>Results</h2>
        {stale && <span className="stale">The project has changed since these were built. Build again to update them.</span>}
      </div>

      <div className={`notice ${summary.tone}`}>
        <div className="notice-title">{summary.title}</div>
        <p className="hint">{summary.detail}</p>
        {report.provenScope === 'all-above-threshold' && report.schedulesDropped > 0 && (
          <p className="hint">
            {n(report.schedulesDropped)} more qualifying schedules were found but not kept. Raise "Schedules to keep" to see them.
          </p>
        )}
      </div>

      <div className="stats">
        <Stat label="Qualifying found" value={n(report.schedulesFound)} />
        <Stat label="Kept" value={n(report.schedulesKept)} />
        <Stat label="Search steps" value={n(report.nodesExplored)} />
        <Stat label="Time" value={`${(report.elapsedMs / 1000).toFixed(1)}s`} />
      </div>

      {schedules.length > 0 && (
        <div className="results">
          <ol className="result-list" aria-label="Schedules by score">
            {schedules.map((s, i) => (
              <li key={i}>
                <button type="button" className="result-item" aria-current={i === index} onClick={() => setSelection({ run, index: i })}>
                  <span>#{i + 1}</span>
                  <span>{score(s.score)}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="stack" style={{ minWidth: 0 }}>
            <h3>
              Schedule #{index + 1} · score {score(schedules[index].score)}
            </h3>
            <ScheduleView schedule={schedules[index]} project={run.project} />
          </div>
        </div>
      )}
    </section>
  )
}
