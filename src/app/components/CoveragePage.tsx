import { useState } from 'react'
import { fmtHour, fmtHourRange } from '../../core/config'
import { DAY_NAMES, HOURS_PER_DAY } from '../../core/types'
import { copyDayCoverage, isOpen, paintCoverage, type Project, type ProjectUpdate } from '../project'
import { Card } from './ui/Card'
import { Segmented } from './ui/Segmented'
import { WeekGrid } from './WeekGrid'

const BRUSHES = [0, 1, 2, 3, 4, 5]

/** Rows worth showing: a normal day by default, stretched to fit any hour that needs people. */
function shownHours(project: Project, allDay: boolean): { from: number; to: number } {
  if (allDay) return { from: 0, to: HOURS_PER_DAY }
  let from = 6
  let to = 22
  for (const win of project.operatingHours) {
    if (!win) continue
    from = Math.min(from, win.startHour)
    to = Math.max(to, win.endHour)
  }
  return { from, to }
}

/** Step 2: how many people each hour needs. An hour needing nobody is closed. */
export function CoveragePage({ project, update }: { project: Project; update: ProjectUpdate }) {
  const [brush, setBrush] = useState(1)
  const [allDay, setAllDay] = useState(false)

  return (
    <Card
      title="When do you need people?"
      description="Pick a number, then click or drag across the grid. 0 means closed."
      info="This is the same every week. Your opening hours come from it: each day opens at its first hour needing someone and closes after its last."
      actions={
        <Segmented
          label="People needed"
          options={BRUSHES.map((n) => ({ value: n, label: n === 0 ? 'Closed' : n, title: n === 0 ? 'Closed' : `${n} ${n === 1 ? 'person' : 'people'}` }))}
          value={brush}
          onChange={setBrush}
        />
      }
    >
      <div className="toolbar">
        <div className="toolbar-actions" style={{ marginLeft: 0 }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => update((p) => copyDayCoverage(p, 0, [1, 2, 3, 4]))}>
            Copy Monday to Tue–Fri
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => update((p) => copyDayCoverage(p, 0, [1, 2, 3, 4, 5, 6]))}>
            Copy Monday to every day
          </button>
        </div>
        <label className="toggle" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" role="switch" className="switch" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span className="toggle-label">Show all 24 hours</span>
        </label>
      </div>

      <WeekGrid
        label="People needed each hour"
        hours={shownHours(project, allDay)}
        onPaint={(slot) => update((p) => paintCoverage(p, [slot], brush))}
        describe={(slot, day, hour) => {
          const when = `${DAY_NAMES[day]} ${fmtHour(hour)}`
          const need = project.minCoverage[slot]
          if (need === 0) {
            return isOpen(project, day, hour)
              ? { className: 'seq-0', text: '0', title: `${when}: open, nobody required` }
              : { className: 'cell-closed', title: `${when}: closed` }
          }
          return { className: `seq-${Math.min(need, 6)}`, text: String(need), title: `${when}: ${need} ${need === 1 ? 'person' : 'people'}` }
        }}
      />

      <p className="hint">
        <strong>Open:</strong>{' '}
        {project.operatingHours.some(Boolean)
          ? DAY_NAMES.map((name, day) => {
              const win = project.operatingHours[day]
              return win ? `${name} ${fmtHourRange(win.startHour, win.endHour)}` : null
            })
              .filter(Boolean)
              .join(' · ')
          : 'no hours yet'}
      </p>
    </Card>
  )
}
