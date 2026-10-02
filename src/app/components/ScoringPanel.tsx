import { useState } from 'react'
import { catalogEntry, type RuleSetting } from '../../core/rules/catalog'
import { applyLevel, LEVELS, levelOf } from '../priorities'
import type { Project, ProjectUpdate } from '../project'
import { NumberField } from './NumberField'
import { Card } from './ui/Card'
import { Segmented } from './ui/Segmented'

export function ScoringPanel({ project, update }: { project: Project; update: ProjectUpdate }) {
  const [exact, setExact] = useState(false)
  const setRule = (id: RuleSetting['id'], change: (setting: RuleSetting) => RuleSetting) =>
    update((p) => ({ ...p, rules: p.rules.map((r) => (r.id === id ? change(r) : r)) }))

  return (
    <Card
      title="Priorities"
      description="What matters most when choosing between schedules. Normal works well for most places."
      info={
        <>
          <p>
            Every schedule starts at 100 points and loses points for each thing below. <strong>High</strong> makes
            the builder avoid that thing harder; <strong>Off</strong> ignores it.
          </p>
          <p>
            Bigger teams lose more points simply because there are more hours, so compare scores within a week rather
            than against 100.
          </p>
        </>
      }
      actions={
        <label className="toggle">
          <input type="checkbox" role="switch" className="switch" checked={exact} onChange={(e) => setExact(e.target.checked)} />
          <span className="toggle-label">Show exact weights</span>
        </label>
      }
      flush
    >
      <div className="table-scroll">
        <table className="rules-table">
          <thead>
            <tr>
              <th scope="col">Avoid…</th>
              <th scope="col">Priority</th>
              {exact && <th scope="col">Weight</th>}
              {exact && <th scope="col">Prunes</th>}
            </tr>
          </thead>
          <tbody>
            {project.rules.map((setting) => {
              const entry = catalogEntry(setting.id)
              const tight = entry.bound === 'tight'
              const level = levelOf(setting)
              return (
                <tr key={setting.id} className={setting.enabled ? '' : 'is-disabled'}>
                  <td>
                    <div className="rule-name">{entry.label}</div>
                    <div className="rule-description">{entry.description}</div>
                    {setting.id === 'shortShift' && (
                      <div className="row" style={{ marginTop: 'var(--s-2)' }}>
                        <span className="hint">Shorter than</span>
                        <NumberField
                          label="Comfortable shift length in hours"
                          hideLabel
                          value={setting.comfortableLength ?? 4}
                          min={1}
                          max={24}
                          disabled={!setting.enabled}
                          onChange={(v) => setRule(setting.id, (r) => ({ ...r, comfortableLength: v }))}
                        />
                        <span className="hint">hours</span>
                      </div>
                    )}
                  </td>
                  <td className="rule-level">
                    <Segmented
                      label={`${entry.label} priority`}
                      options={LEVELS}
                      value={level === 'custom' ? null : level}
                      onChange={(next) => setRule(setting.id, (r) => applyLevel(r, next))}
                    />
                    {level === 'custom' && <span className="pill" title="Set with an exact weight">Custom</span>}
                  </td>
                  {exact && (
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <NumberField
                          label={`${entry.label} weight`}
                          hideLabel
                          value={setting.weight}
                          min={0}
                          step={0.5}
                          integer={false}
                          disabled={!setting.enabled}
                          onChange={(v) => setRule(setting.id, (r) => ({ ...r, weight: v }))}
                        />
                        <span className="hint" style={{ whiteSpace: 'nowrap' }}>{entry.unit}</span>
                      </div>
                    </td>
                  )}
                  {exact && (
                    <td>
                      <span
                        className={`pill${tight ? ' pill--good' : ''}`}
                        title={
                          tight
                            ? 'Known as soon as a shift is assigned, so it cuts branches early.'
                            : 'Only certain late in the search, so it cuts fewer branches.'
                        }
                      >
                        {tight ? 'early' : 'late'}
                      </span>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
