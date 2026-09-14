import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { EmployeesPanel } from './app/components/EmployeesPanel'
import { ScoringPanel } from './app/components/ScoringPanel'
import { SetupPanel } from './app/components/SetupPanel'
import { SolvePanel } from './app/components/SolvePanel'
import {
  loadProject,
  normaliseProject,
  projectFromScenario,
  projectProblems,
  projectToScenario,
  saveProject,
  type Project,
  type ProjectUpdate,
} from './app/project'
import { useSolver } from './app/useSolver'
import { parseScenario, serializeScenario, type ScenarioJson } from './core/io'
import mediumShop from './fixtures/medium-shop.json'
import smallCafe from './fixtures/small-cafe.json'

type Tab = 'setup' | 'employees' | 'scoring' | 'solve'

const EXAMPLES: Record<string, { label: string; json: ScenarioJson }> = {
  'small-cafe': { label: 'Small Cafe (3 people)', json: smallCafe as unknown as ScenarioJson },
  'medium-shop': { label: 'Medium Shop (8 people)', json: mediumShop as unknown as ScenarioJson },
}

const BLANK: ScenarioJson = {
  name: 'New schedule',
  config: {
    operatingHours: { Mon: [9, 17], Tue: [9, 17], Wed: [9, 17], Thu: [9, 17], Fri: [9, 17] },
    minCoverage: 1,
  },
  employees: [],
}

/** `localStorage` can be absent or throw on access (private windows, blocked site data). */
function storage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

type PendingReplace = { label: string; make: () => Project }

export function App() {
  const [project, setProject] = useState<Project>(
    () => loadProject(storage()) ?? projectFromScenario(parseScenario(EXAMPLES['small-cafe'].json)),
  )
  const [tab, setTab] = useState<Tab>('setup')
  const [pending, setPending] = useState<PendingReplace | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const solver = useSolver()

  const update: ProjectUpdate = useCallback((recipe) => setProject((p) => recipe(p)), [])
  const problems = useMemo(() => projectProblems(project), [project])

  useEffect(() => {
    const timer = window.setTimeout(() => setSaveFailed(!saveProject(storage(), project)), 300)
    return () => window.clearTimeout(timer)
  }, [project])

  const confirmReplace = () => {
    if (!pending) return
    setProject(pending.make())
    setPending(null)
    setFileError(null)
    setTab('setup')
  }

  const exportScenario = () => {
    const json = JSON.stringify(serializeScenario(projectToScenario(project)), null, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name.trim().replace(/[^\w-]+/g, '-').toLowerCase() || 'schedule'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const raw = JSON.parse(await file.text()) as unknown
      const asProject = normaliseProject(raw)
      const next = asProject ?? projectFromScenario(parseScenario(raw as ScenarioJson), project.search)
      setPending({ label: `the contents of ${file.name}`, make: () => next })
      setFileError(null)
    } catch (error) {
      setFileError(`Couldn't read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'employees', label: `Employees (${project.employees.length})` },
    { id: 'scoring', label: 'Scoring' },
    { id: 'solve', label: 'Solve', badge: problems.length || undefined },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Schedule Maker</span>
        <input
          type="text"
          className="project-name"
          aria-label="Project name"
          value={project.name}
          onChange={(e) => {
            const name = e.target.value
            update((p) => ({ ...p, name }))
          }}
        />
        <div className="header-actions">
          <select
            aria-label="Load an example"
            value=""
            onChange={(e) => {
              const example = EXAMPLES[e.target.value]
              if (example) setPending({ label: `the ${example.label} example`, make: () => projectFromScenario(parseScenario(example.json)) })
            }}
          >
            <option value="">Load example…</option>
            {Object.entries(EXAMPLES).map(([id, ex]) => (
              <option key={id} value={id}>{ex.label}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setPending({ label: 'a blank project', make: () => projectFromScenario(parseScenario(BLANK)) })}>
            New
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Import</button>
          <button type="button" className="btn" onClick={exportScenario}>Export</button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
        </div>
      </header>

      {pending && (
        <div className="notice notice-warning" style={{ marginTop: '1rem' }} role="alert">
          <div className="notice-title">Replace the current project with {pending.label}?</div>
          <p className="hint">Your current project isn't kept anywhere else. Export it first if you want a copy.</p>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-primary" onClick={confirmReplace}>Replace</button>
            <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {fileError && (
        <div className="notice notice-critical" style={{ marginTop: '1rem' }} role="alert">
          {fileError}
        </div>
      )}
      {saveFailed && (
        <p className="hint" style={{ marginTop: '0.5rem' }}>
          This browser isn't saving changes (storage is blocked). Export your project to keep it.
        </p>
      )}

      <nav className="tabs" role="tablist" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge && <span className="badge" aria-label={`${t.badge} problems`}>{t.badge}</span>}
          </button>
        ))}
      </nav>

      <main role="tabpanel">
        {tab === 'setup' && <SetupPanel project={project} update={update} />}
        {tab === 'employees' && <EmployeesPanel project={project} update={update} />}
        {tab === 'scoring' && <ScoringPanel project={project} update={update} />}
        {tab === 'solve' && <SolvePanel project={project} update={update} solver={solver} problems={problems} />}
      </main>
    </div>
  )
}
