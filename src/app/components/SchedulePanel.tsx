import { useState } from 'react'
import { addDays, formatWeekRange, weekDayIndex } from '../../core/calendar'
import { downloadFile } from '../download'
import {
  dayLabelsFor,
  removeSavedSchedule,
  savedRows,
  savedScheduleFor,
  setWeekStart,
  type Project,
  type ProjectUpdate,
  type SavedSchedule,
} from '../project'
import type { Route } from '../routes'
import { scheduleFileName, shiftListCsv, weekGridCsv } from '../scheduleCsv'
import { colorSlots } from '../people'
import { ScheduleShifts } from './ScheduleShifts'
import { Card } from './ui/Card'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Icon } from './ui/Icon'
import { Menu } from './ui/Menu'

const score = (x: number) => String(Number(x.toFixed(2)))

const savedOn = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

interface SchedulePanelProps {
  project: Project
  update: ProjectUpdate
  navigate: (route: Route) => void
  onStartNextWeek: () => void
}

/** The end of the weekly loop: the chosen schedule, ways to get it out, and the weeks before. */
export function SchedulePanel({ project, update, navigate, onStartNextWeek }: SchedulePanelProps) {
  const [removing, setRemoving] = useState<SavedSchedule | null>(null)
  const current = savedScheduleFor(project, project.weekStart)
  const others = project.saved.filter((s) => s.weekStart !== project.weekStart).reverse()
  const nextWeek = formatWeekRange(addDays(project.weekStart, 7))

  const download = (saved: SavedSchedule, kind: 'grid' | 'shifts') =>
    downloadFile(
      scheduleFileName(project.name, saved.weekStart, kind),
      kind === 'grid' ? weekGridCsv(saved) : shiftListCsv(saved),
      'text/csv;charset=utf-8',
    )

  const csvMenu = (saved: SavedSchedule, compact = false) => (
    <Menu
      label={`Download ${formatWeekRange(saved.weekStart)} as CSV`}
      trigger={
        <>
          <Icon name="download" size={14} /> {compact ? 'CSV' : 'Download CSV'} <Icon name="chevronDown" size={14} />
        </>
      }
      triggerClassName={compact ? 'btn btn--sm' : 'btn'}
      entries={[
        { label: 'Week grid (one row per person)', icon: 'calendar', onSelect: () => download(saved, 'grid') },
        { label: 'Shift list (one row per shift)', icon: 'clipboard', onSelect: () => download(saved, 'shifts') },
      ]}
    />
  )

  return (
    <div className="stack">
      {current ? (
        <Card
          title={`Schedule for ${formatWeekRange(current.weekStart)}`}
          description={`Saved ${savedOn(current.savedAt)} · score ${score(current.score)}`}
          actions={
            <>
              {csvMenu(current)}
              <button type="button" className="btn btn--primary" onClick={onStartNextWeek}>
                Start next week <Icon name="arrowRight" size={14} />
              </button>
            </>
          }
        >
          <SavedShifts project={project} saved={current} />
          <div className="row">
            <span className="hint">Want a different one?</span>
            <button type="button" className="btn btn--sm" onClick={() => navigate({ page: 'generate' })}>Generate again</button>
            <span className="spacer" />
            <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setRemoving(current)}>
              <Icon name="trash" size={14} /> Remove
            </button>
          </div>
        </Card>
      ) : (
        <Card title={`No schedule saved for ${formatWeekRange(project.weekStart)}`} description="Generate schedules, then choose “Use this schedule” on the one you want.">
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => navigate({ page: 'generate' })}>
              <Icon name="play" size={14} /> Go to Generate
            </button>
            <span className="hint">or skip ahead to plan the week of {nextWeek}:</span>
            <button type="button" className="btn btn--sm" onClick={onStartNextWeek}>Start next week</button>
          </div>
        </Card>
      )}

      <Card title="Other weeks" description={others.length ? 'Schedules you saved for other weeks.' : 'Saved schedules for other weeks will appear here.'} flush={others.length > 0}>
        {others.length > 0 && (
          <ul className="history-list">
            {others.map((saved) => {
              const hours = saved.shifts.reduce((sum, s) => sum + s.endHour - s.startHour, 0)
              return (
                <li key={saved.weekStart} className="history-item">
                  <div className="history-text">
                    <span className="history-week">{formatWeekRange(saved.weekStart)}</span>
                    <span className="hint">
                      {hours} staff hours · score {score(saved.score)} · saved {savedOn(saved.savedAt)}
                    </span>
                  </div>
                  <div className="history-actions">
                    <button type="button" className="btn btn--sm" onClick={() => update((p) => setWeekStart(p, saved.weekStart))}>Open</button>
                    {csvMenu(saved, true)}
                    <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Remove the schedule for ${formatWeekRange(saved.weekStart)}`} title="Remove" onClick={() => setRemoving(saved)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this saved schedule?"
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) update((p) => removeSavedSchedule(p, removing.weekStart))
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      >
        <p className="hint">
          The schedule for {removing ? formatWeekRange(removing.weekStart) : ''} will be deleted. You can undo this straight after.
        </p>
      </ConfirmDialog>
    </div>
  )
}

function SavedShifts({ project, saved }: { project: Project; saved: SavedSchedule }) {
  const slots = colorSlots(project, saved.team.map((m) => m.employeeId))
  return (
    <ScheduleShifts
      dayLabels={dayLabelsFor(saved.weekStart)}
      rows={savedRows(saved).map((row, i) => ({
        key: row.employeeId,
        name: row.employeeName,
        hours: row.hours,
        target: row.targetWeeklyHours,
        slot: slots[i],
        blocks: row.shifts.map((s) => ({ day: weekDayIndex(saved.weekStart, s.date) ?? 0, startHour: s.startHour, endHour: s.endHour })),
      }))}
    />
  )
}
