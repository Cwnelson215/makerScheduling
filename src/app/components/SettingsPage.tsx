import type { Project, ProjectUpdate, ShiftRules } from '../project'
import type { Route, SettingsTab } from '../routes'
import { NumberField } from './NumberField'
import { ScoringPanel } from './ScoringPanel'
import { Card } from './ui/Card'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'shifts', label: 'Shift rules' },
  { id: 'priorities', label: 'Priorities' },
]

interface SettingsPageProps {
  project: Project
  update: ProjectUpdate
  navigate: (route: Route) => void
  tab: SettingsTab
}

/** Set once, rarely touched: the limits every shift follows, and what schedules should avoid. */
export function SettingsPage({ project, update, navigate, tab }: SettingsPageProps) {
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Settings</h1>
        <nav className="subtabs" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="subtab"
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => navigate({ page: 'settings', tab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {tab === 'shifts' && <ShiftRulesCard project={project} update={update} />}
      {tab === 'priorities' && <ScoringPanel project={project} update={update} />}
    </div>
  )
}

function ShiftRulesCard({ project, update }: { project: Project; update: ProjectUpdate }) {
  const rules = project.shiftRules
  const setRule = <K extends keyof ShiftRules>(key: K, value: ShiftRules[K]) =>
    update((p) => ({ ...p, shiftRules: { ...p.shiftRules, [key]: value } }))

  return (
    <Card title="Shift rules" description="Limits every shift follows. These never bend.">
      <div className="fields">
        <NumberField label="Shortest shift (hours)" value={rules.minShiftLength} min={1} max={24} onChange={(v) => setRule('minShiftLength', v)} />
        <NumberField label="Longest shift (hours)" value={rules.maxShiftLength} min={1} max={24} onChange={(v) => setRule('maxShiftLength', v)} />
        <NumberField label="Most hours in a day" value={rules.maxDailyHours} min={1} max={24} onChange={(v) => setRule('maxDailyHours', v)} />
        <NumberField label="Days in a row, ideally at most" value={rules.maxConsecutiveDays} min={1} max={7} onChange={(v) => setRule('maxConsecutiveDays', v)} />
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
  )
}
