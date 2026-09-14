import { useState } from 'react'
import { fmtHour } from '../../core/config'
import { DAY_NAMES } from '../../core/types'
import {
  isOpen,
  openSlots,
  paintGrid,
  setOperatingWindow,
  visibleHours,
  weekDayLabels,
  type Project,
  type ProjectUpdate,
  type ShiftRules,
} from '../project'
import { NumberField } from './NumberField'
import { Card } from './ui/Card'
import { Segmented } from './ui/Segmented'
import { WeekGrid } from './WeekGrid'
import { WeekPicker } from './WeekPicker'

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => h)
const BRUSHES = [0, 1, 2, 3, 4, 5]

export function SetupPanel({ project, update }: { project: Project; update: ProjectUpdate }) {
  const [brush, setBrush] = useState(1)
  const rules = project.shiftRules

  const setRule = <K extends keyof ShiftRules>(key: K, value: ShiftRules[K]) =>
    update((p) => ({ ...p, shiftRules: { ...p.shiftRules, [key]: value } }))

  return (
    <div className="stack">
      <div className="setup-grid">
        <div className="stack">
          <Card
            title="Week"
            description="The week you're building a schedule for."
            info="Time off and pinned shifts on these dates apply. Entries for other weeks are kept for when you get there."
          >
            <WeekPicker project={project} update={update} />
          </Card>

          <Card
            title="Operating hours"
            description="When you're open each day."
            info="Closing a day, or narrowing its hours, clears any coverage set outside the new window."
          >
            <div className="day-hours">
              {DAY_NAMES.map((name, day) => {
                const win = project.operatingHours[day]
                return (
                  <div key={name} className="day-row">
                    <span className="day-name">{name}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      className="switch"
                      aria-label={`${name} open`}
                      checked={win !== null}
                      onChange={(e) =>
                        update((p) => setOperatingWindow(p, day, e.target.checked ? { startHour: 9, endHour: 17 } : null))
                      }
                    />
                    {win ? (
                      <div className="time-range">
                        <select
                          aria-label={`${name} opens`}
                          value={win.startHour}
                          onChange={(e) => {
                            const startHour = Number(e.target.value)
                            update((p) => {
                              const end = p.operatingHours[day]?.endHour ?? 17
                              return setOperatingWindow(p, day, { startHour, endHour: Math.max(end, startHour + 1) })
                            })
                          }}
                        >
                          {HOUR_OPTIONS.slice(0, 24).map((h) => (
                            <option key={h} value={h}>{fmtHour(h)}</option>
                          ))}
                        </select>
                        <span className="time-range-sep" aria-hidden="true">–</span>
                        <select
                          aria-label={`${name} closes`}
                          value={win.endHour}
                          onChange={(e) => {
                            const endHour = Number(e.target.value)
                            update((p) => {
                              const start = p.operatingHours[day]?.startHour ?? 9
                              return setOperatingWindow(p, day, { startHour: Math.min(start, endHour - 1), endHour })
                            })
                          }}
                        >
                          {HOUR_OPTIONS.slice(1).map((h) => (
                            <option key={h} value={h}>{h === 24 ? 'midnight' : fmtHour(h)}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className="muted">Closed</span>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        <Card title="Shift rules" description="Hard limits. No shift ever breaks these.">
          <div className="fields">
            <NumberField label="Shortest shift (hours)" value={rules.minShiftLength} min={1} max={24} onChange={(v) => setRule('minShiftLength', v)} />
            <NumberField label="Longest shift (hours)" value={rules.maxShiftLength} min={1} max={24} onChange={(v) => setRule('maxShiftLength', v)} />
            <NumberField label="Most hours in a day" value={rules.maxDailyHours} min={1} max={24} onChange={(v) => setRule('maxDailyHours', v)} />
            <NumberField label="Days in a row before penalty" value={rules.maxConsecutiveDays} min={1} max={7} onChange={(v) => setRule('maxConsecutiveDays', v)} />
          </div>
          <label className="toggle">
            <input type="checkbox" role="switch" className="switch" checked={rules.allowSplitShifts} onChange={(e) => setRule('allowSplitShifts', e.target.checked)} />
            <span className="toggle-text">
              <span className="toggle-label">Allow split shifts</span>
              <span className="toggle-hint">More than one block of work in a day.</span>
            </span>
          </label>
          {rules.allowSplitShifts && (
            <div className="fields nested">
              <NumberField label="Blocks per day, at most" value={rules.maxBlocksPerDay} min={2} max={4} onChange={(v) => setRule('maxBlocksPerDay', v)} />
              <NumberField label="Break between blocks (hours)" value={rules.minGapBetweenBlocks} min={1} max={12} onChange={(v) => setRule('minGapBetweenBlocks', v)} />
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Minimum staff per hour"
        description="Pick a headcount, then click or drag across the grid."
        actions={
          <>
            <Segmented
              label="Headcount"
              options={BRUSHES.map((n) => ({ value: n, label: n, title: `Paint ${n} ${n === 1 ? 'person' : 'people'}` }))}
              value={brush}
              onChange={setBrush}
            />
            <button type="button" className="btn btn--sm" onClick={() => update((p) => ({ ...p, minCoverage: paintGrid(p.minCoverage, openSlots(p), brush) }))}>
              Fill open hours with {brush}
            </button>
          </>
        }
      >
        <WeekGrid
          label="Minimum staff per hour"
          hours={visibleHours(project)}
          dayLabels={weekDayLabels(project)}
          onPaint={(slot) => update((p) => ({ ...p, minCoverage: paintGrid(p.minCoverage, [slot], brush) }))}
          describe={(slot, day, hour) => {
            const when = `${DAY_NAMES[day]} ${fmtHour(hour)}`
            if (!isOpen(project, day, hour)) return { className: 'cell-closed', title: `${when}: closed`, disabled: true }
            const need = project.minCoverage[slot]
            return {
              className: `seq-${Math.min(need, 6)}`,
              text: String(need),
              title: `${when}: ${need} ${need === 1 ? 'person' : 'people'} required`,
            }
          }}
        />
      </Card>
    </div>
  )
}
