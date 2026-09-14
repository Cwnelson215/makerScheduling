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
      <section className="panel stack">
        <div>
          <h2>Week</h2>
          <p className="hint">The week you're building a schedule for. Time off and pinned shifts on these dates apply.</p>
        </div>
        <WeekPicker project={project} update={update} />
      </section>

      <section className="panel stack">
        <div>
          <h2>Operating hours</h2>
          <p className="hint">Closing a day, or narrowing its hours, clears any coverage set outside the new window.</p>
        </div>
        <div className="day-hours">
          {DAY_NAMES.map((name, day) => {
            const win = project.operatingHours[day]
            return (
              <div key={name} style={{ display: 'contents' }}>
                <strong>{name}</strong>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={win !== null}
                    onChange={(e) =>
                      update((p) => setOperatingWindow(p, day, e.target.checked ? { startHour: 9, endHour: 17 } : null))
                    }
                  />
                  Open
                </label>
                <select
                  aria-label={`${name} opens`}
                  disabled={!win}
                  value={win?.startHour ?? 9}
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
                <select
                  aria-label={`${name} closes`}
                  disabled={!win}
                  value={win?.endHour ?? 17}
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
            )
          })}
        </div>
      </section>

      <section className="panel stack">
        <div>
          <h2>Shift rules</h2>
          <p className="hint">Hard limits. The solver never produces a shift that breaks these.</p>
        </div>
        <div className="fields">
          <NumberField label="Shortest shift (hours)" value={rules.minShiftLength} min={1} max={24} onChange={(v) => setRule('minShiftLength', v)} />
          <NumberField label="Longest shift (hours)" value={rules.maxShiftLength} min={1} max={24} onChange={(v) => setRule('maxShiftLength', v)} />
          <NumberField label="Most hours in a day" value={rules.maxDailyHours} min={1} max={24} onChange={(v) => setRule('maxDailyHours', v)} />
          <NumberField label="Days in a row before penalty" value={rules.maxConsecutiveDays} min={1} max={7} onChange={(v) => setRule('maxConsecutiveDays', v)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={rules.allowSplitShifts} onChange={(e) => setRule('allowSplitShifts', e.target.checked)} />
          Allow split shifts (more than one block in a day)
        </label>
        {rules.allowSplitShifts && (
          <div className="fields">
            <NumberField label="Blocks per day, at most" value={rules.maxBlocksPerDay} min={2} max={4} onChange={(v) => setRule('maxBlocksPerDay', v)} />
            <NumberField label="Break between blocks (hours)" value={rules.minGapBetweenBlocks} min={1} max={12} onChange={(v) => setRule('minGapBetweenBlocks', v)} />
          </div>
        )}
      </section>

      <section className="panel stack">
        <div>
          <h2>Minimum staff per hour</h2>
          <p className="hint">Pick a headcount, then click or drag across the grid to paint it.</p>
        </div>
        <div className="row">
          <span className="hint">Headcount</span>
          {BRUSHES.map((n) => (
            <button key={n} type="button" className="btn" aria-pressed={brush === n} onClick={() => setBrush(n)}>
              {n}
            </button>
          ))}
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => update((p) => ({ ...p, minCoverage: paintGrid(p.minCoverage, openSlots(p), brush) }))}>
            Fill all open hours with {brush}
          </button>
        </div>
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
      </section>
    </div>
  )
}
