import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { EmployeesPanel } from './app/components/EmployeesPanel'
import { ScoringPanel } from './app/components/ScoringPanel'
import { SetupPanel } from './app/components/SetupPanel'
import { SolvePanel } from './app/components/SolvePanel'
import { Callout } from './app/components/ui/Callout'
import { ConfirmDialog } from './app/components/ui/ConfirmDialog'
import { Icon, LogoMark, type IconName } from './app/components/ui/Icon'
import { Menu } from './app/components/ui/Menu'
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

  const tabs: { id: Tab; label: string; icon: IconName; count?: number; problems?: number }[] = [
    { id: 'setup', label: 'Setup', icon: 'calendar' },
    { id: 'employees', label: 'Employees', icon: 'users', count: project.employees.length },
    { id: 'scoring', label: 'Scoring', icon: 'sliders' },
    { id: 'solve', label: 'Solve', icon: 'play', problems: problems.length || undefined },
  ]

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-row">
            <div className="brand">
              <span className="brand-mark"><LogoMark /></span>
              <span className="brand-name">Schedule Maker</span>
            </div>
            <span className="crumb-sep" aria-hidden="true">/</span>
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
            <span className="spacer" />
            {saveFailed ? (
              <span className="pill pill--warning" title="This browser isn't saving changes (storage is blocked). Export your project to keep it.">
                <Icon name="alert" size={12} /> Not saving · export to keep
              </span>
            ) : (
              <span className="save-status save-status--ok" title="Changes are saved in this browser automatically">
                <Icon name="check" size={12} /> Saved
              </span>
            )}
            <Menu
              label="Project"
              trigger={<>Project <Icon name="chevronDown" size={14} /></>}
              triggerClassName="btn btn--sm"
              entries={[
                { label: 'New project', icon: 'filePlus', onSelect: () => setPending({ label: 'a blank project', make: () => projectFromScenario(parseScenario(BLANK)) }) },
                { label: 'Import…', icon: 'upload', onSelect: () => fileInput.current?.click() },
                { label: 'Export', icon: 'download', onSelect: exportScenario },
                'separator',
                { heading: 'Load an example' },
                ...Object.values(EXAMPLES).map((example) => ({
                  label: example.label,
                  icon: 'sparkle' as const,
                  onSelect: () => setPending({ label: `the ${example.label} example`, make: () => projectFromScenario(parseScenario(example.json)) }),
                })),
              ]}
            />
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
          </div>

          <nav className="tabs" role="tablist" aria-label="Sections">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={15} />
                {t.label}
                {t.count !== undefined && <span className="pill">{t.count}</span>}
                {t.problems && <span className="pill pill--critical" aria-label={`${t.problems} problems`}>{t.problems}</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="page">
        {fileError && (
          <Callout
            tone="critical"
            role="alert"
            title="Import failed"
            actions={<button type="button" className="btn btn--sm" onClick={() => setFileError(null)}>Dismiss</button>}
          >
            <p className="hint">{fileError}</p>
          </Callout>
        )}

        <main role="tabpanel">
          {tab === 'setup' && <SetupPanel project={project} update={update} />}
          {tab === 'employees' && <EmployeesPanel project={project} update={update} />}
          {tab === 'scoring' && <ScoringPanel project={project} update={update} />}
          {tab === 'solve' && <SolvePanel project={project} update={update} solver={solver} problems={problems} />}
        </main>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Replace this project?"
        confirmLabel="Replace"
        onConfirm={confirmReplace}
        onCancel={() => setPending(null)}
      >
        <p className="hint">
          This loads {pending?.label}. Your current project isn't kept anywhere else, so export it first if you want a copy.
        </p>
      </ConfirmDialog>
    </>
  )
}
