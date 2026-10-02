import { useState } from 'react'
import { formatWeekRange } from '../../core/calendar'
import type { SearchReport } from '../../core/report'
import { savedScheduleFor, solveKey, type Project, type ProjectUpdate } from '../project'
import type { Route } from '../routes'
import type { SolvedRun, useSolver } from '../useSolver'
import { NumberField } from './NumberField'
import { ScheduleView } from './ScheduleView'
import { Callout } from './ui/Callout'
import { Card } from './ui/Card'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Icon } from './ui/Icon'
import { Segmented } from './ui/Segmented'

const n = (x: number) => x.toLocaleString()
const score = (x: number) => String(Number(x.toFixed(2)))

const SEARCH_TIMES = [
  { value: 5, label: 'Quick', title: '5 seconds' },
  { value: 15, label: 'Normal', title: '15 seconds' },
  { value: 60, label: 'Thorough', title: '1 minute' },
]

function stopDescription(report: SearchReport): string {
  switch (report.stopReason) {
    case 'timeBudget':
      return 'the time limit'
    case 'nodeBudget':
      return 'the step limit'
    default:
      return 'an early stop'
  }
}

interface SolvePanelProps {
  project: Project
  update: ProjectUpdate
  solver: ReturnType<typeof useSolver>
  problems: string[]
  navigate: (route: Route) => void
  onUseSchedule: (run: SolvedRun, index: number) => void
}

export function SolvePanel({ project, update, solver, problems, navigate, onUseSchedule }: SolvePanelProps) {
  const { activity, result } = solver
  const running = activity.kind === 'running'
  const blocked = problems.length > 0
  const search = project.search
  const saved = savedScheduleFor(project, project.weekStart)
  const presetTime = SEARCH_TIMES.some((t) => t.value === search.timeLimitSeconds)
  // Options built for another week would only mislead; the week's own build replaces them.
  const weekResult = result && result.project.weekStart === project.weekStart ? result : null

  const setSearch = (patch: Partial<Project['search']>) => update((p) => ({ ...p, search: { ...p.search, ...patch } }))

  return (
    <div className="stack">
      <Card
        title="Generate schedules"
        description={`Finds the best schedules for the week of ${formatWeekRange(project.weekStart)} from who's working and the coverage you need.`}
      >
        <div className="build-row">
          {running ? (
            <button type="button" className="btn btn--lg btn--danger" onClick={solver.cancel}>
              <Icon name="stop" size={14} /> Stop
            </button>
          ) : (
            <button type="button" className="btn btn--lg btn--primary" disabled={blocked} onClick={() => solver.solve(project)}>
              <Icon name="play" size={14} /> {weekResult ? 'Generate again' : 'Generate schedules'}
            </button>
          )}
          <div className="toolbar-group">
            <span className="section-label">Search time</span>
            <div className="row">
              <Segmented
                label="Search time"
                options={SEARCH_TIMES}
                value={presetTime ? search.timeLimitSeconds : null}
                onChange={(seconds) => setSearch({ timeLimitSeconds: seconds })}
              />
              {!presetTime && <span className="pill">Custom · {search.timeLimitSeconds}s</span>}
            </div>
          </div>
        </div>

        {saved && (
          <Callout
            tone="good"
            title="This week already has a saved schedule"
            actions={<button type="button" className="btn btn--sm" onClick={() => navigate({ page: 'schedule' })}>View it</button>}
          >
            <p className="hint">Generating again won't change it unless you choose a different one.</p>
          </Callout>
        )}

        {blocked && (
          <Callout
            tone="critical"
            role="alert"
            title="Fix these before generating"
            actions={
              <>
                <button type="button" className="btn btn--sm" onClick={() => navigate({ page: 'coverage' })}>Go to Coverage</button>
                <button type="button" className="btn btn--sm" onClick={() => navigate({ page: 'employees' })}>Go to Employees</button>
              </>
            }
          >
            <ul>
              {problems.slice(0, 8).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            {problems.length > 8 && <p className="hint">…and {problems.length - 8} more.</p>}
          </Callout>
        )}

        <ActivityView activity={activity} onDismiss={solver.dismiss} onUseThreshold={(t) => update((p) => ({ ...p, threshold: t }))} />

        <details className="disclosure">
          <summary>
            <Icon name="chevronRight" size={14} />
            Advanced
            {search.useThreshold && <span className="disclosure-summary-note">· keeping schedules scoring at least {score(project.threshold)}</span>}
          </summary>
          <div className="disclosure-body stack nested">
            <div className="fields">
              <NumberField label="Options to keep" value={search.maxResults} min={1} max={1000} onChange={(v) => setSearch({ maxResults: v })} />
              <NumberField label="Search time (seconds)" value={search.timeLimitSeconds} min={1} max={600} onChange={(v) => setSearch({ timeLimitSeconds: v })} />
            </div>
            <label className="toggle">
              <input type="checkbox" role="switch" className="switch" checked={search.useThreshold} onChange={(e) => setSearch({ useThreshold: e.target.checked })} />
              <span className="toggle-text">
                <span className="toggle-label">Keep every schedule above a minimum score</span>
                <span className="toggle-hint">
                  Instead of the best few, keep all schedules scoring at least the number below (up to "Options to keep").
                </span>
              </span>
            </label>
            {search.useThreshold && (
              <div className="stack nested">
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <NumberField
                    label="Minimum score"
                    value={project.threshold}
                    integer={false}
                    step={1}
                    onChange={(v) => update((p) => ({ ...p, threshold: v }))}
                  />
                  <button type="button" className="btn" disabled={blocked || running} onClick={() => solver.calibrate(project)}>
                    <Icon name="target" size={14} /> Find achievable score
                  </button>
                </div>
                <label className="toggle">
                  <input type="checkbox" role="switch" className="switch" checked={search.tightenToBest} onChange={(e) => setSearch({ tightenToBest: e.target.checked })} />
                  <span className="toggle-text">
                    <span className="toggle-label">Focus on the best schedules only</span>
                    <span className="toggle-hint">
                      Much faster on large rosters. Once enough are kept, it skips anything that can't beat the weakest of them.
                    </span>
                  </span>
                </label>
              </div>
            )}
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
      </Card>

      {weekResult && <ResultSection run={weekResult} project={project} onUseSchedule={onUseSchedule} />}
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
              {activity.mode === 'calibrate' ? 'Finding the best achievable score…' : 'Generating schedules…'}
            </span>
            <span className="spacer" />
            <span className="hint tabular">{elapsed.toFixed(0)}s of {activity.timeLimitSeconds}s</span>
          </div>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={activity.timeLimitSeconds} aria-valuenow={Math.round(elapsed)}>
            <div style={{ width: `${Math.min(100, (elapsed / activity.timeLimitSeconds) * 100)}%` }} />
          </div>
          <div className="stats">
            <Stat label="Schedules found" value={p ? n(p.schedulesFound) : '—'} />
            <Stat label="Best score so far" value={p?.bestScore != null ? score(p.bestScore) : '—'} />
          </div>
          <p className="hint">Stopping throws away this run. To finish sooner and keep what's found, choose a shorter search time.</p>
        </div>
      )
    }
    case 'calibrated': {
      const { bestScore, suggestedThreshold, report } = activity
      if (bestScore === null) {
        return (
          <Callout tone="warning" title="No complete schedule found within the limit" actions={dismiss}>
            <p className="hint">The roster may be impossible to staff, or it needs more time. Try a longer search time.</p>
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
                Use {suggestedThreshold} as minimum
              </button>
              {dismiss}
            </>
          }
        >
          <p className="hint">
            {report.complete
              ? 'This is the true best. The search finished.'
              : `The search stopped at ${stopDescription(report)}, so a higher score may exist.`}{' '}
            A minimum of {suggestedThreshold} keeps a band of good schedules rather than only the single best.
          </p>
        </Callout>
      )
    }
    case 'error':
      return (
        <Callout tone="critical" role="alert" title="Couldn't generate" actions={dismiss}>
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

function summarise(run: SolvedRun): { tone: 'good' | 'warning'; title: string; detail: string } {
  const { report, schedules } = run
  const count = schedules.length

  if (!run.project.search.useThreshold) {
    if (count === 0) {
      return report.complete
        ? {
            tone: 'warning',
            title: 'No schedule is possible',
            detail: "Staff needed, availability, time off and shift rules can't all be met at once. Check Coverage, and who's working.",
          }
        : {
            tone: 'warning',
            title: 'No schedule found in time',
            detail: 'Try Thorough, or check that enough people are available for the staff needed.',
          }
    }
    return report.complete
      ? {
          tone: 'good',
          title: count === 1 ? 'Here is the best schedule' : `Here are the ${n(count)} best schedules`,
          detail: 'The search finished, so there are none better. Pick one and choose "Use this schedule".',
        }
      : {
          tone: 'warning',
          title: `Search time ran out — here are the best ${n(count)} found so far`,
          detail: 'They all work. Try Thorough if you want the chance of better ones.',
        }
  }

  const threshold = score(report.threshold)
  if (!report.complete) {
    return {
      tone: 'warning',
      title: `Stopped at ${stopDescription(report)}`,
      detail:
        count > 0
          ? 'These are the schedules found so far. Better ones may exist in the part of the search that was not reached.'
          : `No schedule scoring ${threshold} or more turned up before the limit. Try a longer search time or a lower minimum.`,
    }
  }
  if (count === 0) {
    return { tone: 'warning', title: `No schedule can score ${threshold} or more`, detail: 'The search finished, so this is certain. Lower the minimum or ease the rules.' }
  }
  if (report.provenScope === 'top-k') {
    return {
      tone: 'good',
      title: `These are the ${n(count)} best schedules`,
      detail: 'The search finished. Because it focused on the best only, this is not every schedule above the minimum.',
    }
  }
  return { tone: 'good', title: `Every schedule scoring ${threshold} or more was found`, detail: 'The search finished, so nothing that qualifies was missed.' }
}

function ResultSection({ run, project, onUseSchedule }: { run: SolvedRun; project: Project; onUseSchedule: (run: SolvedRun, index: number) => void }) {
  const [selection, setSelection] = useState<{ run: SolvedRun; index: number } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const index = selection?.run === run ? selection.index : 0
  const { report, schedules } = run
  const stale = solveKey(run.project) !== solveKey(project)
  const summary = summarise(run)
  const replacing = savedScheduleFor(project, run.project.weekStart) !== null

  // Bars compare the options with each other: the best fills the bar, the weakest gets a sliver.
  const scores = schedules.map((s) => s.score)
  const top = Math.max(...scores)
  const floor = Math.min(...scores) - Math.max(1, (top - Math.min(...scores)) * 0.25)
  const barWidth = (value: number) => Math.max(4, ((value - floor) / (top - floor)) * 100)

  const use = () => {
    setConfirming(false)
    onUseSchedule(run, index)
  }

  return (
    <Card
      title="Options"
      description={`Week of ${formatWeekRange(run.project.weekStart)}`}
      actions={
        stale && (
          <span className="pill pill--warning" title="Something has changed since these were generated. Generate again to update them.">
            <Icon name="alert" size={12} /> Out of date · generate again
          </span>
        )
      }
    >
      <Callout tone={summary.tone} title={summary.title}>
        <p className="hint">{summary.detail}</p>
        {run.project.search.useThreshold && report.provenScope === 'all-above-threshold' && report.schedulesDropped > 0 && (
          <p className="hint">
            {n(report.schedulesDropped)} more qualifying schedules were found but not kept. Raise "Options to keep" to see them.
          </p>
        )}
      </Callout>

      {schedules.length > 0 && (
        <div className="results">
          <ol className="result-list" aria-label="Options by score">
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
            <div className="option-head">
              <h3 className="schedule-title">
                Option {index + 1}
                <span className="pill pill--accent">score {score(schedules[index].score)}</span>
              </h3>
              <span className="spacer" />
              {stale && <span className="hint">Generate again to use an up-to-date option.</span>}
              <button type="button" className="btn btn--primary" disabled={stale} onClick={() => (replacing ? setConfirming(true) : use())}>
                <Icon name="check" size={14} /> Use this schedule
              </button>
            </div>
            <ScheduleView schedule={schedules[index]} project={run.project} />
          </div>
        </div>
      )}

      <p className="hint">
        {n(report.schedulesFound)} found in {(report.elapsedMs / 1000).toFixed(1)}s · {n(report.nodesExplored)} search steps
      </p>

      <ConfirmDialog
        open={confirming}
        title="Replace this week's saved schedule?"
        confirmLabel="Replace"
        onConfirm={use}
        onCancel={() => setConfirming(false)}
      >
        <p className="hint">The week of {formatWeekRange(run.project.weekStart)} already has a saved schedule. Option {index + 1} will take its place.</p>
      </ConfirmDialog>
    </Card>
  )
}
