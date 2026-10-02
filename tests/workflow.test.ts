import { describe, expect, it } from 'vitest'
import { colorSlots, personClass } from '../src/app/people'
import { applyLevel, levelOf } from '../src/app/priorities'
import { parseRoute, routeHash, type Route } from '../src/app/routes'
import {
  copyDayCoverage,
  excludedFor,
  normaliseProject,
  paintCoverage,
  projectFromScenario,
  projectToProblem,
  removeSavedSchedule,
  saveWeekSchedule,
  savedRows,
  savedScheduleFor,
  setWeekStart,
  setWorking,
  windowsFromCoverage,
  workingEmployees,
  type Project,
  type SavedSchedule,
} from '../src/app/project'
import { scheduleFileName, shiftListCsv, weekGridCsv } from '../src/app/scheduleCsv'
import { stepStates } from '../src/app/steps'
import { THEME_KEY, loadTheme, resolveTheme, saveTheme } from '../src/app/theme'
import { edit, initialHistory, MERGE_MS, redo, replace, undo } from '../src/app/useUndoable'
import { defaultRuleSettings } from '../src/core/rules/catalog'
import { solve } from '../src/core/search/solver'
import { slotIndex, type Schedule } from '../src/core/types'
import { handleRequest } from '../src/worker/handler'
import type { SolveResponse } from '../src/worker/protocol'
import { FIXTURE_WEEK, loadFixture } from './helpers'

const cafe = (): Project => projectFromScenario({ ...loadFixture('small-cafe.json'), name: 'Small Cafe', weekStart: FIXTURE_WEEK })

/** Blocks for small-cafe's three employees (ana, ben, cleo), in roster order. */
const fakeSchedule = (score = 80): Schedule => ({
  patternIndices: new Int32Array(0),
  blocks: [
    [{ day: 0, startHour: 9, endHour: 13 }],
    [
      { day: 1, startHour: 11, endHour: 15 },
      { day: 0, startHour: 12, endHour: 15 },
    ],
    [],
  ],
  hoursPerEmployee: [4, 7, 0],
  score,
  penalties: {},
})

describe('saved schedules', () => {
  it('stores dated shifts with names and the whole team, sorted by date', () => {
    const project = cafe()
    const next = saveWeekSchedule(project, project, fakeSchedule(), new Date('2026-09-20T10:00:00Z'))
    const saved = savedScheduleFor(next, FIXTURE_WEEK)!
    expect(saved.score).toBe(80)
    expect(saved.savedAt).toBe('2026-09-20T10:00:00.000Z')
    expect(saved.team.map((m) => m.employeeId)).toEqual(project.employees.map((e) => e.id))
    expect(saved.shifts.map((s) => [s.employeeName, s.date, s.startHour, s.endHour])).toEqual([
      [project.employees[0].name, '2026-09-21', 9, 13],
      [project.employees[1].name, '2026-09-21', 12, 15],
      [project.employees[1].name, '2026-09-22', 11, 15],
    ])
    expect(savedRows(saved).map((r) => r.hours)).toEqual([4, 7, 0])
  })

  it('keeps one schedule per week, in week order', () => {
    const project = cafe()
    const nextWeek = { ...project, weekStart: '2026-09-28' }
    let p = saveWeekSchedule(project, nextWeek, fakeSchedule(70))
    p = saveWeekSchedule(p, project, fakeSchedule(60))
    p = saveWeekSchedule(p, project, fakeSchedule(90))
    expect(p.saved.map((s) => [s.weekStart, s.score])).toEqual([
      ['2026-09-21', 90],
      ['2026-09-28', 70],
    ])
    expect(removeSavedSchedule(p, '2026-09-21').saved.map((s) => s.weekStart)).toEqual(['2026-09-28'])
  })

  it('survives a storage round trip, and older saves load without any', () => {
    const project = saveWeekSchedule(cafe(), cafe(), fakeSchedule())
    expect(normaliseProject(JSON.parse(JSON.stringify(project)))!.saved).toEqual(project.saved)

    const { saved: _saved, ...older } = JSON.parse(JSON.stringify(cafe()))
    expect(normaliseProject(older)!.saved).toEqual([])
  })

  it('rejects a malformed saved schedule', () => {
    const project = JSON.parse(JSON.stringify(saveWeekSchedule(cafe(), cafe(), fakeSchedule())))
    project.saved[0].shifts[0].endHour = 30
    expect(normaliseProject(project)).toBeNull()
  })
})

describe('schedule CSV', () => {
  const saved: SavedSchedule = {
    weekStart: '2026-09-21',
    savedAt: '2026-09-20T10:00:00.000Z',
    score: 80,
    team: [
      { employeeId: 'a', employeeName: 'Smith, "Jo"', targetWeeklyHours: 8 },
      { employeeId: 'b', employeeName: 'Ben', targetWeeklyHours: 8 },
    ],
    shifts: [
      { employeeId: 'a', employeeName: 'Smith, "Jo"', date: '2026-09-21', startHour: 9, endHour: 13 },
      { employeeId: 'a', employeeName: 'Smith, "Jo"', date: '2026-09-21', startHour: 17, endHour: 24 },
    ],
  }

  it('writes a week grid with quoting, a BOM and CRLF', () => {
    const csv = weekGridCsv(saved)
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Employee,Mon 21 Sep,Tue 22 Sep,Wed 23 Sep,Thu 24 Sep,Fri 25 Sep,Sat 26 Sep,Sun 27 Sep,Total hours')
    expect(lines[1]).toBe('"Smith, ""Jo""",9am-1pm; 5pm-12am,,,,,,,11')
    expect(lines[2]).toBe('Ben,,,,,,,,0')
    expect(lines[3]).toBe('')
  })

  it('writes a shift list with 24-hour times', () => {
    const lines = shiftListCsv(saved).slice(1).split('\r\n')
    expect(lines[0]).toBe('Employee,Date,Day,Start,End,Hours')
    expect(lines[1]).toBe('"Smith, ""Jo""",2026-09-21,Mon,09:00,13:00,4')
    expect(lines[2]).toBe('"Smith, ""Jo""",2026-09-21,Mon,17:00,00:00,7')
  })

  it('names files after the project and week', () => {
    expect(scheduleFileName('  Small Café! ', '2026-09-21', 'grid')).toBe('small-caf-schedule-2026-09-21.csv')
    expect(scheduleFileName('', '2026-09-21', 'shifts')).toBe('schedule-shifts-2026-09-21.csv')
  })
})

describe('undo history', () => {
  it('merges quick edits into one step and separates slow ones', () => {
    let h = initialHistory(0)
    h = edit(h, 1, 1000)
    h = edit(h, 2, 1000 + MERGE_MS - 1)
    h = edit(h, 3, 1000 + 3 * MERGE_MS)
    expect(h.past).toEqual([0, 2])
    expect(undo(h).present).toBe(2)
    expect(undo(undo(h)).present).toBe(0)
  })

  it('redoes, and a new edit clears the redo stack', () => {
    let h = edit(edit(initialHistory('a'), 'b', 1000), 'c', 5000)
    h = undo(h)
    expect(redo(h).present).toBe('c')
    h = edit(h, 'd', 9000)
    expect(h.future).toEqual([])
    expect(redo(h)).toBe(h)
  })

  it('never merges into a step right after undo or a replace', () => {
    let h = edit(initialHistory(0), 1, 1000)
    h = undo(h)
    h = edit(h, 5, 1001)
    expect(h.past).toEqual([0])
    h = replace(h, 9)
    h = edit(h, 10, 1002)
    expect(h.past).toEqual([0, 5, 9])
  })
})

describe('steps', () => {
  it('tracks progress through the week', () => {
    const project = cafe()
    expect(stepStates(project, false)).toEqual({ employees: 'done', coverage: 'done', generate: 'todo', schedule: 'todo' })
    expect(stepStates(project, true).generate).toBe('done')
    expect(stepStates(saveWeekSchedule(project, project, fakeSchedule()), true).schedule).toBe('done')
  })

  it('flags an unbuildable project and an empty one', () => {
    const empty = { ...cafe(), employees: [], minCoverage: new Array<number>(168).fill(0) }
    const states = stepStates(empty, false)
    expect(states.coverage).toBe('todo')
    expect(states.employees).toBe('todo')
    expect(states.generate).toBe('attention')
  })
})

describe('priority levels', () => {
  it('maps levels to multiples of the default weight and back', () => {
    for (const setting of defaultRuleSettings()) {
      expect(levelOf(setting)).toBe('normal')
      for (const level of ['off', 'low', 'normal', 'high'] as const) {
        expect(levelOf(applyLevel(setting, level))).toBe(level)
      }
    }
  })

  it('reports an exact weight between levels as custom', () => {
    const [setting] = defaultRuleSettings()
    expect(levelOf({ ...setting, weight: setting.weight * 1.3 })).toBe('custom')
  })
})

describe('best-options build', () => {
  it('returns the best schedules found, best first, without a threshold', () => {
    const project = cafe()
    project.threshold = 1000 // ignored in this mode
    project.search = { ...project.search, maxResults: 5, timeLimitSeconds: 60, useThreshold: false }
    const messages: SolveResponse[] = []
    handleRequest({ type: 'solve', runId: 1, project }, (m) => messages.push(structuredClone(m)))
    const terminal = messages.find((m) => m.type === 'solved')
    if (terminal?.type !== 'solved') throw new Error('expected a solve')

    const scores = terminal.schedules.map((s) => s.score)
    expect(scores).toHaveLength(5)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)

    const { employees, config } = projectToProblem(project)
    const all = solve(employees, config, { threshold: -Infinity, maxResults: 100_000, maxMillis: 60_000, maxNodes: Infinity })
    expect(scores).toEqual(all.schedules.slice(0, 5).map((s) => s.score))
  })
})

describe('who works which week', () => {
  it('starts with everyone, and a week carries over into later weeks', () => {
    const project = cafe()
    const [ana, ben] = project.employees
    expect(workingEmployees(project)).toHaveLength(3)

    let p = setWorking(project, ben.id, false)
    expect(workingEmployees(p).map((e) => e.id)).not.toContain(ben.id)
    p = setWeekStart(p, '2026-10-05')
    expect(excludedFor(p, p.weekStart)).toEqual([ben.id])

    // A change in a later week leaves the earlier one alone.
    p = setWorking(p, ana.id, false)
    expect(excludedFor(p, '2026-09-21')).toEqual([ben.id])
    expect(excludedFor(p, '2026-10-12').sort()).toEqual([ana.id, ben.id].sort())
    // Weeks before any entry have everyone.
    expect(excludedFor(p, '2026-09-14')).toEqual([])
  })

  it('leaves excluded people out of the solve and lines results up with who is working', () => {
    const project = setWorking(cafe(), cafe().employees[0].id, false)
    const { employees } = projectToProblem(project)
    expect(employees.map((e) => e.id)).toEqual(workingEmployees(project).map((e) => e.id))

    const schedule: Schedule = { ...fakeSchedule(), blocks: [[{ day: 0, startHour: 9, endHour: 12 }], []], hoursPerEmployee: [3, 0] }
    const saved = savedScheduleFor(saveWeekSchedule(project, project, schedule), FIXTURE_WEEK)!
    expect(saved.team.map((m) => m.employeeId)).toEqual(workingEmployees(project).map((e) => e.id))
    expect(saved.shifts[0].employeeId).toBe(workingEmployees(project)[0].id)
  })

  it('round-trips through storage and rejects a bad week key', () => {
    const project = setWorking(cafe(), cafe().employees[1].id, false)
    expect(normaliseProject(JSON.parse(JSON.stringify(project)))!.excluded).toEqual(project.excluded)
    expect(normaliseProject({ ...project, excluded: { '2026-09-22': [] } })).toBeNull()
  })
})

describe('coverage sets opening hours', () => {
  it('opens each day from its first to its last hour needing someone', () => {
    const grid = new Array<number>(168).fill(0)
    grid[slotIndex(0, 9)] = 1
    grid[slotIndex(0, 14)] = 2
    expect(windowsFromCoverage(grid)).toEqual([{ startHour: 9, endHour: 15 }, null, null, null, null, null, null])
  })

  it('updates opening hours as coverage is painted and copied', () => {
    let p = cafe()
    p = paintCoverage(p, [slotIndex(0, 8)], 2)
    expect(p.operatingHours[0]).toEqual({ startHour: 8, endHour: 15 })
    p = copyDayCoverage(p, 0, [2])
    expect(p.operatingHours[2]).toEqual({ startHour: 8, endHour: 15 })
    p = paintCoverage(p, Array.from({ length: 24 }, (_, h) => slotIndex(2, h)), 0)
    expect(p.operatingHours[2]).toBeNull()
  })
})

describe('routes', () => {
  it('round-trips every page through the URL hash', () => {
    const routes: Route[] = [
      { page: 'employees' },
      { page: 'employee', id: 'ana lee', tab: 'time-off' },
      { page: 'coverage' },
      { page: 'generate' },
      { page: 'schedule' },
      { page: 'settings', tab: 'priorities' },
    ]
    for (const route of routes) expect(parseRoute(routeHash(route))).toEqual(route)
  })

  it('falls back sensibly for unknown or partial hashes', () => {
    expect(parseRoute('')).toEqual({ page: 'employees' })
    expect(parseRoute('#/nowhere')).toEqual({ page: 'employees' })
    expect(parseRoute('#/employees/ana')).toEqual({ page: 'employee', id: 'ana', tab: 'details' })
    expect(parseRoute('#/settings/bogus')).toEqual({ page: 'settings', tab: 'shifts' })
  })
})

describe('person colours', () => {
  it('keeps each person\'s colour when someone is left out of the week', () => {
    const project = cafe()
    const ids = project.employees.map((e) => e.id)
    const without = workingEmployees(setWorking(project, ids[0], false)).map((e) => e.id)
    expect(colorSlots(project, ids)).toEqual(ids.map((_, i) => i))
    expect(colorSlots(project, without)).toEqual(ids.slice(1).map((_, i) => i + 1))
  })

  it('gives people who have left the roster slots of their own', () => {
    const project = cafe()
    const n = project.employees.length
    expect(colorSlots(project, ['gone', project.employees[0].id, 'also-gone'])).toEqual([n, 0, n + 1])
  })

  it('reuses the eight hues with a stripe from the ninth person on', () => {
    expect(personClass(0)).toBe('person-1')
    expect(personClass(7)).toBe('person-8')
    expect(personClass(8)).toBe('person-1 person-alt')
    expect(personClass(16)).toBe('person-1')
  })
})

describe('theme', () => {
  const memory = () => {
    const items = new Map<string, string>()
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    }
  }

  it('follows the device until a theme is chosen', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('remembers a choice and forgets it on going back to the device', () => {
    const storage = memory()
    expect(loadTheme(storage)).toBe('system')
    saveTheme(storage, 'light')
    expect(loadTheme(storage)).toBe('light')
    saveTheme(storage, 'system')
    expect(storage.items.has(THEME_KEY)).toBe(false)
  })

  it('treats missing, broken or unrecognised storage as following the device', () => {
    expect(loadTheme(undefined)).toBe('system')
    expect(loadTheme({ getItem: () => 'sepia' })).toBe('system')
    expect(loadTheme({ getItem: () => { throw new Error('blocked') } })).toBe('system')
  })
})
