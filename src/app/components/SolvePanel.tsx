import { useMemo, useState } from 'react'
import { formatWeekRange } from '../../core/calendar'
import type { SearchReport } from '../../core/report'
import type { Project, ProjectUpdate } from '../project'
import type { SolvedRun, useSolver } from '../useSolver'
import { NumberField } from './NumberField'
import { ScheduleView } from './ScheduleView'
import { Callout } from './ui/Callout'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'

const n = (x: number) => x.toLocaleString()
const score = (x: number) => String(Number(x.toFixed(2)))

/** The parts of a project that change which schedules are valid or how they score. */
const solveInputs = (p: Project) =>
  JSON.stringify([p.weekStart, p.operatingHours, p.minCoverage, p.shiftRules, p.employees, p.rules, p.threshold])

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

  const advancedNote = [search.tightenToBest && 'best only', search.maxNodes !== null && `${n(search.maxNodes)} step cap`]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="stack">
      <Card
        title="Build schedules"
        description="Search for rosters that score at or above the threshold."
        actions={
          running ? (
            <button type="button" className="btn btn--danger" onClick={solver.cancel}>
              <Icon name="stop" size={14} /> Stop
            </button>
          ) : (
            <>
              <button type="button" className="btn" disabled={blocked} onClick={() => solver.calibrate(project)}>
                <Icon name="target" size={14} /> Find achievable score
              </button>
              <button type="button" className="btn btn--primary" disabled={blocked} onClick={() => solver.solve(project)}>
                <Icon name="play" size={14} /> Build schedules
              </button>
            </>
          )
        }
      >
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

        <details className="disclosure">
          <summary>
            <Icon name="chevronRight" size={14} />
            Search options
            {advancedNote && <span className="disclosure-summary-note">· {advancedNote}</span>}
          </summary>
          <div className="disclosure-body stack nested">
            <label className="toggle">
              <input type="checkbox" role="switch" className="switch" checked={search.tightenToBest} onChange={(e) => setSearch({ tightenToBest: e.target.checked })} />
              <span className="toggle-text">
                <span className="toggle-label">Focus on the best schedules only</span>
                <span className="toggle-hint">
                  Much faster on large rosters. Once enough schedules are kept, it skips anything that can't beat the weakest of
                  them, so you get the best ones rather than every schedule above the threshold.
                </span>
              </span>
            </label>
            <label className="toggle">
              <input type="checkbox" role="switch" className="switch" checked={search.maxNodes !== null} onChange={(e) => setSearch({ maxNodes: e.target.checked ? 5_000_000 : null })} />
              <span className="toggle-text">
                <span className="toggle-label">Also cap the number of search steps</span>
              </span>
            </label>
            {search.maxNodes !== null && (
              <div className="fields">
                <NumberField label="Search step limit" value={search.maxNodes} min={1000} step={100000} onChange={(v) => setSearch({ maxNodes: v })} />
              </div>
            )}
          </div>
        </details>

        {blocked && (
          <Callout tone="critical" role="alert" title="Fix these before building schedules">
            <ul>
              {problems.slice(0, 8).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            {problems.length > 8 && <p className="hint">…and {problems.length - 8} more.</p>}
          </Callout>
        )}

        <ActivityView activity={activity} onDismiss={solver.dismiss} onUseThreshold={(t) => update((p) => ({ ...p, threshold: t }))} />
      </Card>

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
  const dismiss = (
    <button type="button" className="btn btn--sm" onClick={onDismiss}>Dismiss</button>
  )
  switch (activity.kind) {
    case 'idle':
      return null
    case 'running': {
      const p = activity.progress
      const elapsed = p ? p.elapsedMs / 1000 : 0
      return (
        <div className="progress" aria-live="polite">
          <div className="progress-head">
            <span className="spinner" aria-hidden="true" />
            <span className="callout-title">
              {activity.mode === 'calibrate' ? 'Finding the best achievable score…' : 'Searching…'}
            </span>
            <span className="spacer" />
            <span className="hint tabular">{elapsed.toFixed(1)}s of {activity.timeLimitSeconds}s</span>
          </div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={activity.timeLimitSeconds} aria-valuenow={Math.round(elapsed)}>
            <div style={{ width: `${Math.min(100, (elapsed / activity.timeLimitSeconds) * 100)}%` }} />
          </div>
          <div className="stats">
            <Stat label="Search steps" value={p ? n(p.nodesExplored) : '—'} />
            <Stat label="Schedules found" value={p ? n(p.schedulesFound) : '—'} />
            <Stat label="Best score" value={p?.bestScore != null ? score(p.bestScore) : '—'} />
          </div>
          <p className="hint">Stopping throws away this run. To stop sooner and keep results, lower the time limit.</p>
        </div>
      )
    }
    case 'calibrated': {
      const { bestScore, suggestedThreshold, report } = activity
      if (bestScore === null) {
        return (
          <Callout tone="warning" title="No complete schedule found within the limit" actions={dismiss}>
            <p className="hint">The roster may be impossible to staff, or it needs more time. Try raising the time limit.</p>
          </Callout>
        )
      }
      return (
        <Callout
          tone={report.complete ? 'good' : 'warning'}
          title={`Best achievable score: ${score(bestScore)}`}
          actions={
            <>
              <button type="button" className="btn btn--sm btn--primary" onClick={() => { onUseThreshold(suggestedThreshold!); onDismiss() }}>
                Use {suggestedThreshold} as threshold
              </button>
              {dismiss}
            </>
          }
        >
          <p className="hint">
            {report.complete
              ? 'This is the true best. The search finished.'
              : `The search stopped at ${stopDescription(report)}, so a higher score may exist.`}{' '}
            A threshold of {suggestedThreshold} keeps a band of good schedules rather than only the single best.
          </p>
        </Callout>
      )
    }
    case 'error':
      return (
        <Callout tone="critical" role="alert" title="The solver couldn't run" actions={dismiss}>
          {activity.problems ? (
            <ul>{activity.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          ) : (
            <p className="hint">{activity.message}</p>
          )}
        </Callout>
      )
    case 'cancelled':
      return <Callout tone="warning" title="Stopped. Nothing from that run was kept." actions={dismiss} />
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
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

  let summary: { tone: 'good' | 'warning'; title: string; detail: string }
  if (!report.complete) {
    summary = {
      tone: 'warning',
      title: `Stopped at ${stopDescription(report)}`,
      detail:
        schedules.length > 0
          ? 'These are the schedules found so far. Better ones may exist in the part of the search that was not reached.'
          : `No schedule scoring ${threshold} or more turned up before the limit. Try a longer time limit, a lower threshold, or "Focus on the best schedules only".`,
    }
  } else if (schedules.length === 0) {
    summary = {
      tone: 'warning',
      title: `No schedule can score ${threshold} or more`,
      detail: 'The search finished, so this is certain. Lower the threshold or ease the rules.',
    }
  } else if (report.provenScope === 'top-k') {
    summary = {
      tone: 'good',
      title: `These are the ${n(schedules.length)} best schedules`,
      detail: 'The search finished. Because it focused on the best only, this is not every schedule above the threshold.',
    }
  } else {
    summary = {
      tone: 'good',
      title: `Every schedule scoring ${threshold} or more was found`,
      detail: 'The search finished, so nothing that qualifies was missed.',
    }
  }

  // Bars run from the threshold (or the weakest kept score, if lower) up to a perfect 100.
  const floor = Math.min(report.threshold, ...schedules.map((s) => s.score))
  const barWidth = (value: number) => (100 - floor <= 0 ? 100 : Math.max(4, ((value - floor) / (100 - floor)) * 100))

  return (
    <Card
      title="Results"
      description={`Week of ${formatWeekRange(run.project.weekStart)}`}
      actions={
        stale && (
          <span className="pill pill--warning" title="The project has changed since these were built. Build again to update them.">
            <Icon name="alert" size={12} /> Out of date · build again to update
          </span>
        )
      }
    >
      <Callout tone={summary.tone} title={summary.title}>
        <p className="hint">{summary.detail}</p>
        {report.provenScope === 'all-above-threshold' && report.schedulesDropped > 0 && (
          <p className="hint">
            {n(report.schedulesDropped)} more qualifying schedules were found but not kept. Raise "Schedules to keep" to see them.
          </p>
        )}
      </Callout>

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
                  <span className="result-rank">#{i + 1}</span>
                  <span className="result-bar" aria-hidden="true">
                    <span style={{ width: `${barWidth(s.score)}%` }} />
                  </span>
                  <span className="result-score">{score(s.score)}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="stack" style={{ minWidth: 0 }}>
            <h3 className="schedule-title">
              Schedule #{index + 1}
              <span className="pill pill--accent">score {score(schedules[index].score)}</span>
            </h3>
            <ScheduleView schedule={schedules[index]} project={run.project} />
          </div>
        </div>
      )}
    </Card>
  )
}
