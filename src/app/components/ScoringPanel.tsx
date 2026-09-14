import { catalogEntry, type RuleSetting } from '../../core/rules/catalog'
import type { Project, ProjectUpdate } from '../project'
import { NumberField } from './NumberField'

export function ScoringPanel({ project, update }: { project: Project; update: ProjectUpdate }) {
  const setRule = (id: RuleSetting['id'], patch: Partial<RuleSetting>) =>
    update((p) => ({ ...p, rules: p.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))

  return (
    <section className="panel stack">
      <div className="stack" style={{ gap: '0.35rem' }}>
        <h2>Scoring rules</h2>
        <p className="hint">
          Every schedule starts at 100. Each rule subtracts its weight for every unit of penalty, so a higher weight
          means the solver avoids that thing harder. Weights can't go negative: rules only ever subtract, which is what
          lets the solver drop weak branches early without losing good schedules.
        </p>
        <p className="hint">
          Scores fall as rosters grow, since there are simply more hours to penalize. Use <strong>Find achievable score</strong>{' '}
          on the Solve tab to pick a sensible threshold.
        </p>
      </div>

      <div className="table-scroll">
        <table className="rules-table">
          <thead>
            <tr>
              <th scope="col">On</th>
              <th scope="col">Rule</th>
              <th scope="col">Weight</th>
              <th scope="col">Prunes</th>
            </tr>
          </thead>
          <tbody>
            {project.rules.map((setting) => {
              const entry = catalogEntry(setting.id)
              return (
                <tr key={setting.id} className={setting.enabled ? '' : 'is-disabled'}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Use ${entry.label}`}
                      checked={setting.enabled}
                      onChange={(e) => setRule(setting.id, { enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{entry.label}</div>
                    <div className="hint">{entry.description}</div>
                    {setting.id === 'shortShift' && (
                      <div className="row" style={{ marginTop: '0.4rem' }}>
                        <span className="hint">Shorter than</span>
                        <NumberField
                          label="Comfortable shift length in hours"
                          hideLabel
                          value={setting.comfortableLength ?? 4}
                          min={1}
                          max={24}
                          disabled={!setting.enabled}
                          onChange={(v) => setRule(setting.id, { comfortableLength: v })}
                        />
                        <span className="hint">hours</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'nowrap' }}>
                      <NumberField
                        label={`${entry.label} weight`}
                        hideLabel
                        value={setting.weight}
                        min={0}
                        step={0.5}
                        integer={false}
                        disabled={!setting.enabled}
                        onChange={(v) => setRule(setting.id, { weight: v })}
                      />
                      <span className="hint" style={{ whiteSpace: 'nowrap' }}>{entry.unit}</span>
                    </div>
                  </td>
                  <td>
                    <span
                      className="tag"
                      title={
                        entry.bound === 'tight'
                          ? 'Known as soon as a shift is assigned, so it cuts branches early.'
                          : 'Only certain late in the search, so it cuts fewer branches.'
                      }
                    >
                      {entry.bound === 'tight' ? 'early' : 'late'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
