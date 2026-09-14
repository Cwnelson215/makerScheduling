import { describe, expect, it } from 'vitest'
import {
  addException,
  entryTiming,
  loadProject,
  normaliseProject,
  projectFromScenario,
  projectProblems,
  projectToProblem,
  projectToScenario,
  removeException,
  saveProject,
  setOperatingWindow,
  setWeekStart,
  STORAGE_KEY,
} from '../src/app/project'
import { parseScenario, ScenarioError, serializeScenario, type Scenario, type ScenarioJson } from '../src/core/io'
import { defaultRules } from '../src/core/rules/builtins'
import { buildRules, defaultRuleSettings, normaliseRuleSettings } from '../src/core/rules/catalog'
import { solve } from '../src/core/search/solver'
import { slotIndex } from '../src/core/types'
import { handleRequest } from '../src/worker/handler'
import type { SolveResponse } from '../src/worker/protocol'
import { FIXTURE_WEEK, loadFixture, SMALL_CAFE_EXCEPTIONS } from './helpers'

/** Typed arrays don't deep-equal plain arrays, so compare scenarios in a neutral form. */
const plain = (s: Scenario) =>
  JSON.parse(
    JSON.stringify(s, (_key, value) => (ArrayBuffer.isView(value) ? Array.from(value as Uint8Array) : value)),
  )

describe('scenario serialization', () => {
  for (const fixture of ['small-cafe.json', 'medium-shop.json']) {
    it(`${fixture}: parse(serialize(s)) reproduces s exactly`, () => {
      const scenario = parseScenario(JSON.parse(JSON.stringify(serializeScenario(loadFixtureScenario(fixture)))))
      expect(plain(scenario)).toEqual(plain(loadFixtureScenario(fixture)))
    })
  }

  it('round-trips a week with dated time off and pins', () => {
    const json = serializeScenario(datedScenario())
    expect(json.weekStart).toBe(FIXTURE_WEEK)
    // Whole-day time off is written without hours, as someone would write it by hand.
    expect(json.employees.find((e) => e.id === 'ben')!.timeOff).toEqual([{ date: '2026-09-22' }])
    expect(json.employees.find((e) => e.id === 'cleo')!.pins).toEqual([{ date: '2026-09-22', hours: [13, 14] }])
    expect(plain(parseScenario(JSON.parse(JSON.stringify(json))))).toEqual(plain(datedScenario()))
  })

  it('rejects malformed dated entries with a readable reason', () => {
    const base = () => serializeScenario(datedScenario())
    const expectError = (mutate: (json: ScenarioJson) => void, fragment: string) => {
      const json = base()
      mutate(json)
      expect(() => parseScenario(json)).toThrow(ScenarioError)
      expect(() => parseScenario(json)).toThrow(fragment)
    }
    expectError((j) => delete j.weekStart, 'dated entries need a top-level weekStart')
    expectError((j) => (j.weekStart = '2026-09-23'), 'must be a Monday')
    expectError((j) => (j.employees[1].timeOff = [{ date: '2026-02-30' }]), 'is not a YYYY-MM-DD date')
    expectError((j) => (j.employees[2].pins = [{ date: '2026-09-22' } as never]), 'a pin needs hours')
    expectError((j) => (j.employees[2].pins = [{ date: '2026-09-22', hours: [14, 13] }]), 'out of bounds or empty')
  })

  it('preserves per-hour coverage changes, including adjacent different headcounts', () => {
    const scenario = loadFixtureScenario('small-cafe.json')
    scenario.config.minCoverage[slotIndex(0, 10)] = 3
    scenario.config.minCoverage[slotIndex(0, 11)] = 2
    const again = parseScenario(serializeScenario(scenario))
    expect(Array.from(again.config.minCoverage)).toEqual(Array.from(scenario.config.minCoverage))
  })
})

function loadFixtureScenario(name: string): Scenario {
  return { ...loadFixture(name), name, weekStart: FIXTURE_WEEK }
}

/** small-cafe with a week and dated entries of every kind. */
function datedScenario(): Scenario {
  return { ...loadFixtureScenario('small-cafe.json'), exceptions: structuredClone(SMALL_CAFE_EXCEPTIONS) }
}

describe('rule catalog', () => {
  it('default settings build the same rules as defaultRules()', () => {
    const fromSettings = buildRules(defaultRuleSettings()).map((r) => [r.id, r.weight])
    const builtin = defaultRules().map((r) => [r.id, r.weight])
    expect(fromSettings).toEqual(builtin)
  })

  it('leaves disabled rules out entirely', () => {
    const settings = defaultRuleSettings().map((s) => (s.id === 'clopen' ? { ...s, enabled: false } : s))
    expect(buildRules(settings).map((r) => r.id)).not.toContain('clopen')
  })

  it('fills in missing rules, drops unknown ids, and clamps negative weights', () => {
    const settings = normaliseRuleSettings([
      { id: 'splitShift', weight: 9, enabled: false },
      { id: 'clopen', weight: -4 },
      { id: 'notARule' as never, weight: 1 },
    ])
    expect(settings.map((s) => s.id)).toEqual(defaultRuleSettings().map((s) => s.id))
    expect(settings.find((s) => s.id === 'splitShift')).toMatchObject({ weight: 9, enabled: false })
    expect(settings.find((s) => s.id === 'clopen')!.weight).toBe(0)
  })

  it('solving with catalog rules matches solving with the builtins', () => {
    const { employees, config } = loadFixture('small-cafe.json')
    const shared = { threshold: 70, maxResults: 1_000_000, maxNodes: Infinity, maxMillis: Infinity }
    const viaCatalog = solve(employees, config, { ...shared, rules: buildRules(defaultRuleSettings()) })
    const viaBuiltins = solve(employees, config, { ...shared, rules: defaultRules() })
    const keys = (r: typeof viaCatalog) => r.schedules.map((s) => `${s.patternIndices.join(',')}@${s.score}`)
    expect(keys(viaCatalog)).toEqual(keys(viaBuiltins))
  })
})

describe('project model', () => {
  const scenario = () => loadFixtureScenario('medium-shop.json')

  it('round-trips a scenario through the editor model', () => {
    expect(plain(projectToScenario(projectFromScenario(scenario())))).toEqual(plain(scenario()))
  })

  it('round-trips a dated scenario through the editor model', () => {
    expect(plain(projectToScenario(projectFromScenario(datedScenario())))).toEqual(plain(datedScenario()))
  })

  it('schedules a scenario without a week for the current week', () => {
    const undated = { ...loadFixtureScenario('small-cafe.json'), weekStart: null }
    expect(projectFromScenario(undated, undefined, '2026-09-17').weekStart).toBe('2026-09-14')
  })

  it('survives JSON storage unchanged', () => {
    const project = projectFromScenario(scenario())
    expect(normaliseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
  })

  it('rejects structurally broken documents', () => {
    const project = projectFromScenario(scenario())
    expect(normaliseProject(null)).toBeNull()
    expect(normaliseProject({ ...project, version: 2 })).toBeNull()
    expect(normaliseProject({ ...project, minCoverage: [1, 2, 3] })).toBeNull()
    expect(normaliseProject({ ...project, employees: [{ ...project.employees[0], availability: [] }] })).toBeNull()
  })

  it('fills optional sections an older save might lack', () => {
    const { rules: _rules, search: _search, weekStart: _week, ...older } = projectFromScenario(scenario())
    older.employees = older.employees.map(({ timeOff: _t, pins: _p, ...e }) => e as never)
    const loaded = normaliseProject(older, '2026-09-17')
    expect(loaded?.rules).toEqual(defaultRuleSettings())
    expect(loaded?.search.timeLimitSeconds).toBeGreaterThan(0)
    expect(loaded?.weekStart).toBe('2026-09-14')
    expect(loaded?.employees.every((e) => e.timeOff.length === 0 && e.pins.length === 0)).toBe(true)
  })

  it('rejects malformed dated entries and weeks', () => {
    const project = projectFromScenario(datedScenario())
    const withEntry = (entry: unknown) => ({
      ...project,
      employees: [{ ...project.employees[0], pins: [entry] }, ...project.employees.slice(1)],
    })
    expect(normaliseProject(withEntry({ id: 'x', date: '2026-09-21', startHour: 9, endHour: 12 }))).not.toBeNull()
    expect(normaliseProject(withEntry({ id: 'x', date: '2026-02-30', startHour: 9, endHour: 12 }))).toBeNull()
    expect(normaliseProject(withEntry({ id: 'x', date: '2026-09-21', startHour: 12, endHour: 9 }))).toBeNull()
    expect(normaliseProject({ ...project, weekStart: '2026-09-22' })).toBeNull()
  })

  it('edits the week and dated entries', () => {
    let project = projectFromScenario(datedScenario())
    expect(setWeekStart(project, '2026-10-01').weekStart).toBe('2026-09-28')

    const ana = project.employees[0].id
    project = addException(project, ana, 'pins', { date: '2026-09-22', startHour: 9, endHour: 12 })
    project = addException(project, ana, 'pins', { date: '2026-09-18', startHour: 9, endHour: 10 })
    expect(project.employees[0].pins.map((p) => p.date)).toEqual(['2026-09-18', '2026-09-21', '2026-09-22'])
    expect(project.employees[0].pins.map((p) => entryTiming(project, p))).toEqual(['past', 'thisWeek', 'thisWeek'])
    expect(entryTiming(project, project.employees[0].timeOff[0])).toBe('later')

    const removed = removeException(project, ana, 'pins', project.employees[0].pins[0].id)
    expect(removed.employees[0].pins.map((p) => p.date)).toEqual(['2026-09-21', '2026-09-22'])
    expect(removed.employees[1]).toBe(project.employees[1])
  })

  it('reports a pin that clashes with time off', () => {
    const project = addException(projectFromScenario(datedScenario()), 'ben', 'pins', {
      date: '2026-09-22',
      startHour: 10,
      endHour: 13,
    })
    expect(projectProblems(project)).toContain(
      'Ben is pinned Tue 10am–1pm but is unavailable then (availability or time off)',
    )
  })

  it('closing or narrowing a day clears coverage outside the new window', () => {
    const project = projectFromScenario(scenario())
    const narrowed = setOperatingWindow(project, 0, { startHour: 12, endHour: 16 })
    expect(narrowed.minCoverage[slotIndex(0, 8)]).toBe(0)
    expect(narrowed.minCoverage[slotIndex(0, 12)]).toBe(project.minCoverage[slotIndex(0, 12)])
    expect(narrowed.minCoverage[slotIndex(0, 16)]).toBe(0)
    expect(projectProblems(narrowed).some((p) => p.includes('outside operating hours'))).toBe(false)

    const closed = setOperatingWindow(project, 1, null)
    for (let hour = 0; hour < 24; hour++) expect(closed.minCoverage[slotIndex(1, hour)]).toBe(0)
  })

  it('surfaces validation problems without throwing', () => {
    const project = projectFromScenario(scenario())
    expect(projectProblems(project)).toEqual([])
    expect(projectProblems({ ...project, employees: [] })).toContain('no employees provided')
  })

  it('treats unavailable or failing storage as empty rather than crashing', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
    }
    expect(loadProject(throwing)).toBeNull()
    expect(loadProject(undefined)).toBeNull()
    expect(saveProject(throwing, projectFromScenario(scenario()))).toBe(false)
    expect(saveProject(undefined, projectFromScenario(scenario()))).toBe(false)
  })

  it('saves and loads through storage', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const project = projectFromScenario(scenario())
    expect(saveProject(storage, project)).toBe(true)
    expect(store.has(STORAGE_KEY)).toBe(true)
    expect(loadProject(storage)).toEqual(project)
  })
})

describe('solver progress', () => {
  it('reports progress that ends at the final totals', () => {
    const { employees, config } = loadFixture('medium-shop.json')
    const seen: number[] = []
    const { report } = solve(employees, config, {
      threshold: -200,
      maxNodes: 40_000,
      progressIntervalMs: 0,
      onProgress: (p) => seen.push(p.nodesExplored),
    })
    expect(seen.length).toBeGreaterThan(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(seen[seen.length - 1]).toBe(report.nodesExplored)
  })
})

/**
 * The worker handler is the whole solver as the UI sees it. Every message must survive
 * structured cloning, or `postMessage` fails at runtime in the browser — a failure no
 * typecheck would catch.
 */
describe('worker handler', () => {
  const run = (type: 'solve' | 'calibrate', project = projectFromScenario(loadFixtureScenario('small-cafe.json'))) => {
    const messages: SolveResponse[] = []
    handleRequest({ type, runId: 7, project }, (m) => messages.push(structuredClone(m)))
    return messages
  }

  it('answers a solve with exactly one terminal message matching a direct solve', () => {
    const project = projectFromScenario(loadFixtureScenario('small-cafe.json'))
    project.threshold = 70
    project.search = { ...project.search, maxResults: 1000, timeLimitSeconds: 60 }
    const messages = run('solve', project)

    const terminal = messages.filter((m) => m.type !== 'progress')
    expect(terminal).toHaveLength(1)
    expect(terminal[0].runId).toBe(7)
    expect(terminal[0].type).toBe('solved')

    const { employees, config } = projectToProblem(project)
    const direct = solve(employees, config, { threshold: 70, maxResults: 1000, maxMillis: 60_000, maxNodes: Infinity })
    if (terminal[0].type !== 'solved') throw new Error('unreachable')
    expect(terminal[0].report.complete).toBe(true)
    expect(terminal[0].schedules.map((s) => s.score)).toEqual(direct.schedules.map((s) => s.score))
  })

  it('solves with this week\'s pins and time off applied', () => {
    const project = projectFromScenario(datedScenario())
    project.threshold = -Infinity
    project.search = { ...project.search, maxResults: 10_000, timeLimitSeconds: 60 }
    const [terminal] = run('solve', project).filter((m) => m.type !== 'progress')
    if (terminal.type !== 'solved') throw new Error(`expected a solve, got ${terminal.type}`)
    expect(terminal.report.complete).toBe(true)
    expect(terminal.schedules.length).toBeGreaterThan(0)

    const index = (id: string) => project.employees.findIndex((e) => e.id === id)
    const worked = (blocks: { day: number; startHour: number; endHour: number }[], day: number, hour: number) =>
      blocks.some((b) => b.day === day && b.startHour <= hour && hour < b.endHour)
    for (const schedule of terminal.schedules) {
      expect(worked(schedule.blocks[index('ana')], 0, 9) && worked(schedule.blocks[index('ana')], 0, 10)).toBe(true)
      expect(schedule.blocks[index('ben')].some((b) => b.day === 1)).toBe(false)
      expect(worked(schedule.blocks[index('cleo')], 1, 13)).toBe(true)
    }
  })

  it('answers a calibration', () => {
    const terminal = run('calibrate').filter((m) => m.type !== 'progress')
    expect(terminal).toHaveLength(1)
    expect(terminal[0]).toMatchObject({ type: 'calibrated', runId: 7, bestScore: 80 })
  })

  it('turns an invalid project into an error message with the problem list', () => {
    const project = { ...projectFromScenario(loadFixtureScenario('small-cafe.json')), employees: [] }
    const [message] = run('solve', project)
    expect(message.type).toBe('error')
    if (message.type !== 'error') throw new Error('unreachable')
    expect(message.problems).toContain('no employees provided')
  })
})
