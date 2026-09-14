import {
  addDays,
  formatShortDate,
  isIsoDate,
  mondayOf,
  parseIsoDate,
  resolveWeek,
  todayIso,
  weekDayIndex,
  type DatedHours,
  type EmployeeExceptions,
  type IsoDate,
} from '../core/calendar'
import { ConfigError, DEFAULT_CONFIG, validateProblem } from '../core/config'
import type { Scenario } from '../core/io'
import { normaliseRuleSettings, type RuleSetting } from '../core/rules/catalog'
import {
  Availability,
  DAY_NAMES,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  WEEK_HOURS,
  slotIndex,
  type Employee,
  type OperatingWindow,
  type ScheduleConfig,
} from '../core/types'

/**
 * The editor's working document.
 *
 * Deliberately plain data — number arrays instead of typed arrays, settings instead of rule
 * objects — so it round-trips through `JSON.stringify` for `localStorage` and through
 * `postMessage` to the solver worker without any custom encoding. {@link projectToProblem}
 * converts it to the solver's types at the boundary.
 */
export interface Project {
  version: 1
  name: string
  /** Monday of the week being scheduled. Dated time off and pins apply only within it. */
  weekStart: IsoDate
  operatingHours: (OperatingWindow | null)[]
  /** 168 entries, `slotIndex(day, hour)`. */
  minCoverage: number[]
  shiftRules: ShiftRules
  employees: ProjectEmployee[]
  rules: RuleSetting[]
  threshold: number
  search: SearchSettings
}

/**
 * How panels change the project: always via a recipe over the latest state. A paint drag fires
 * many events between renders, and a plain `setProject(next)` built from a stale render would
 * silently drop earlier cells of the stroke.
 */
export type ProjectUpdate = (recipe: (project: Project) => Project) => void

export interface ProjectEmployee {
  id: string
  name: string
  maxWeeklyHours: number
  targetWeeklyHours: number
  /** 168 entries of {@link Availability}. The recurring week; time off overrides it. */
  availability: number[]
  timeOff: ProjectException[]
  pins: ProjectException[]
}

/** A dated time-off or pin entry, with an id so the editor can list and remove it. */
export interface ProjectException extends DatedHours {
  id: string
}

export type ExceptionKind = 'timeOff' | 'pins'

export type ShiftRules = Pick<
  ScheduleConfig,
  | 'minShiftLength'
  | 'maxShiftLength'
  | 'maxDailyHours'
  | 'allowSplitShifts'
  | 'minGapBetweenBlocks'
  | 'maxBlocksPerDay'
  | 'maxConsecutiveDays'
>

export interface SearchSettings {
  maxResults: number
  /** Wall-clock budget. The main stop condition in the UI, since node counts mean little to people. */
  timeLimitSeconds: number
  /** `null` means no node limit — JSON cannot store `Infinity`. */
  maxNodes: number | null
  tightenToBest: boolean
}

export const DEFAULT_SEARCH: SearchSettings = {
  maxResults: 50,
  timeLimitSeconds: 10,
  maxNodes: null,
  tightenToBest: false,
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function shiftRulesOf(config: ScheduleConfig): ShiftRules {
  return {
    minShiftLength: config.minShiftLength,
    maxShiftLength: config.maxShiftLength,
    maxDailyHours: config.maxDailyHours,
    allowSplitShifts: config.allowSplitShifts,
    minGapBetweenBlocks: config.minGapBetweenBlocks,
    maxBlocksPerDay: config.maxBlocksPerDay,
    maxConsecutiveDays: config.maxConsecutiveDays,
  }
}

/** A scenario without a week of its own is scheduled for the current week. */
export function projectFromScenario(scenario: Scenario, search = DEFAULT_SEARCH, today = todayIso()): Project {
  const entries = (list: DatedHours[] | undefined): ProjectException[] =>
    (list ?? []).map(({ date, startHour, endHour }) => ({ id: newId(), date, startHour, endHour }))
  return {
    version: 1,
    name: scenario.name,
    weekStart: scenario.weekStart ?? mondayOf(today),
    operatingHours: scenario.config.operatingHours.map((w) => (w ? { ...w } : null)),
    minCoverage: Array.from(scenario.config.minCoverage),
    shiftRules: shiftRulesOf(scenario.config),
    employees: scenario.employees.map((e) => ({
      id: e.id,
      name: e.name,
      maxWeeklyHours: e.maxWeeklyHours,
      targetWeeklyHours: e.targetWeeklyHours,
      availability: Array.from(e.availability),
      timeOff: entries(scenario.exceptions[e.id]?.timeOff),
      pins: entries(scenario.exceptions[e.id]?.pins),
    })),
    rules: scenario.rules.map((r) => ({ ...r })),
    threshold: scenario.threshold,
    search: { ...search },
  }
}

/** What the solver sees: the roster with this week's time off and pins applied. */
export function projectToProblem(project: Project): { employees: Employee[]; config: ScheduleConfig } {
  const { employees, config } = projectRoster(project)
  return { employees: resolveWeek(employees, project.weekStart, projectExceptions(project)), config }
}

function projectExceptions(project: Project): Record<string, EmployeeExceptions> {
  const strip = ({ date, startHour, endHour }: ProjectException): DatedHours => ({ date, startHour, endHour })
  return Object.fromEntries(
    project.employees.map((e) => [e.id, { timeOff: e.timeOff.map(strip), pins: e.pins.map(strip) }]),
  )
}

/** The recurring roster, before any dated entries are applied. */
function projectRoster(project: Project): { employees: Employee[]; config: ScheduleConfig } {
  return {
    employees: project.employees.map((e) => ({
      id: e.id,
      name: e.name,
      maxWeeklyHours: e.maxWeeklyHours,
      targetWeeklyHours: e.targetWeeklyHours,
      availability: Uint8Array.from(e.availability),
    })),
    config: {
      ...DEFAULT_CONFIG,
      ...project.shiftRules,
      operatingHours: project.operatingHours.map((w) => (w ? { ...w } : null)),
      minCoverage: Uint8Array.from(project.minCoverage),
    },
  }
}

export function projectToScenario(project: Project): Scenario {
  return {
    name: project.name,
    threshold: project.threshold,
    rules: project.rules,
    weekStart: project.weekStart,
    exceptions: projectExceptions(project),
    ...projectRoster(project),
  }
}

/** Every reason the solver would refuse this project, or an empty list. */
export function projectProblems(project: Project): string[] {
  const { employees, config } = projectToProblem(project)
  try {
    validateProblem(employees, config)
    return []
  } catch (error) {
    if (error instanceof ConfigError) return error.problems
    throw error
  }
}

export function isOpen(project: Project, day: number, hour: number): boolean {
  const win = project.operatingHours[day]
  return win !== null && hour >= win.startHour && hour < win.endHour
}

/**
 * Hours worth showing in a week grid: from the earliest opening to the latest closing across
 * the week. Rendering all 24 rows would bury a 9-to-5 shop in empty night hours.
 */
export function visibleHours(project: Project): { from: number; to: number } {
  let from = HOURS_PER_DAY
  let to = 0
  for (const win of project.operatingHours) {
    if (!win) continue
    from = Math.min(from, win.startHour)
    to = Math.max(to, win.endHour)
  }
  return from < to ? { from, to } : { from: 8, to: 18 }
}

// ---------------------------------------------------------------------------
// Edits. Each returns a new project; nothing mutates in place, so React state stays honest.
// ---------------------------------------------------------------------------

/**
 * Changes a day's window and clears coverage that would fall outside it. Leaving that coverage
 * in place would make the project unsolvable (the validator rejects coverage demanded while
 * closed) for a reason the admin can no longer see in the grid.
 */
export function setOperatingWindow(project: Project, day: number, win: OperatingWindow | null): Project {
  const operatingHours = project.operatingHours.slice()
  operatingHours[day] = win
  const minCoverage = project.minCoverage.slice()
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    const open = win !== null && hour >= win.startHour && hour < win.endHour
    if (!open) minCoverage[slotIndex(day, hour)] = 0
  }
  return { ...project, operatingHours, minCoverage }
}

/** Sets every listed cell of a 168-entry grid to `value`, returning a new grid. */
export function paintGrid(grid: readonly number[], slots: Iterable<number>, value: number): number[] {
  const next = grid.slice()
  for (const slot of slots) next[slot] = value
  return next
}

/** Every slot inside operating hours — the target of "fill all open hours" actions. */
export function openSlots(project: Project): number[] {
  const slots: number[] = []
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      if (isOpen(project, day, hour)) slots.push(slotIndex(day, hour))
    }
  }
  return slots
}

export function newEmployee(project: Project): ProjectEmployee {
  const availability = new Array<number>(WEEK_HOURS).fill(Availability.Unavailable)
  for (const slot of openSlots(project)) availability[slot] = Availability.Preferred
  return {
    id: newId(),
    name: `Employee ${project.employees.length + 1}`,
    maxWeeklyHours: 40,
    targetWeeklyHours: 20,
    availability,
    timeOff: [],
    pins: [],
  }
}

export function updateEmployee(project: Project, id: string, patch: Partial<ProjectEmployee>): Project {
  return {
    ...project,
    employees: project.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }
}

/** Moves the project to the week containing `date`. */
export function setWeekStart(project: Project, date: IsoDate): Project {
  return isIsoDate(date) ? { ...project, weekStart: mondayOf(date) } : project
}

export function addException(
  project: Project,
  employeeId: string,
  kind: ExceptionKind,
  entry: DatedHours,
): Project {
  return {
    ...project,
    employees: project.employees.map((e) =>
      e.id === employeeId
        ? { ...e, [kind]: sortByDate([...e[kind], { id: newId(), ...entry }]) }
        : e,
    ),
  }
}

export function removeException(project: Project, employeeId: string, kind: ExceptionKind, id: string): Project {
  return {
    ...project,
    employees: project.employees.map((e) =>
      e.id === employeeId ? { ...e, [kind]: e[kind].filter((x) => x.id !== id) } : e,
    ),
  }
}

function sortByDate(entries: ProjectException[]): ProjectException[] {
  return entries.slice().sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
}

/** Column headers for the project's week: `'Mon 21'`. */
export function weekDayLabels(project: Project): string[] {
  return DAY_NAMES.map((name, day) => `${name} ${Number(addDays(project.weekStart, day).slice(8))}`)
}

/** `'Tue 22 Sep'`. */
export function formatEntryDate(date: IsoDate): string {
  const weekday = DAY_NAMES[weekDayIndex(mondayOf(date), date)!]
  return `${weekday} ${formatShortDate(date)}`
}

/** 168-entry grids marking which hours this week's time off and pins cover for `employee`. */
export function weekMarks(project: Project, employee: ProjectEmployee): { timeOff: boolean[]; pinned: boolean[] } {
  const mark = (entries: DatedHours[]) => {
    const grid = new Array<boolean>(WEEK_HOURS).fill(false)
    for (const entry of entries) {
      const day = weekDayIndex(project.weekStart, entry.date)
      if (day === null) continue
      for (let hour = entry.startHour; hour < entry.endHour; hour++) grid[slotIndex(day, hour)] = true
    }
    return grid
  }
  return { timeOff: mark(employee.timeOff), pinned: mark(employee.pins) }
}

/** Where a dated entry falls relative to the project's week. */
export function entryTiming(project: Project, entry: DatedHours): 'past' | 'thisWeek' | 'later' {
  const offset = parseIsoDate(entry.date)! - parseIsoDate(project.weekStart)!
  return offset < 0 ? 'past' : offset < DAYS_PER_WEEK ? 'thisWeek' : 'later'
}

// ---------------------------------------------------------------------------
// Persistence.
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'scheduleMaker.project.v1'

const isEntry = (value: unknown): value is DatedHours => {
  const v = value as Partial<DatedHours> | null
  return (
    typeof v === 'object' && v !== null && isIsoDate(v.date) &&
    Number.isInteger(v.startHour) && Number.isInteger(v.endHour) &&
    v.startHour! >= 0 && v.startHour! < v.endHour! && v.endHour! <= HOURS_PER_DAY
  )
}

/** Entries from storage, or `null` if any is malformed. Missing lists are older saves: empty. */
function normaliseEntries(raw: unknown): ProjectException[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || !raw.every(isEntry)) return null
  return raw.map((entry) => ({
    id: typeof (entry as Partial<ProjectException>).id === 'string' ? (entry as ProjectException).id : newId(),
    date: entry.date,
    startHour: entry.startHour,
    endHour: entry.endHour,
  }))
}

const isGrid = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length === WEEK_HOURS && value.every((v) => Number.isInteger(v) && v >= 0)

/**
 * Accepts anything that came out of storage or a file and returns a well-formed project, or
 * `null`. Structural problems reject the whole document; merely-missing optional sections
 * (rules, search settings) fall back to defaults so older saves keep loading.
 */
export function normaliseProject(raw: unknown, today = todayIso()): Project | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Partial<Project>
  if (p.version !== 1 || typeof p.name !== 'string') return null
  if (!Array.isArray(p.operatingHours) || p.operatingHours.length !== DAYS_PER_WEEK) return null
  if (!isGrid(p.minCoverage) || !Array.isArray(p.employees) || typeof p.shiftRules !== 'object') return null
  if (p.weekStart !== undefined && (!isIsoDate(p.weekStart) || mondayOf(p.weekStart) !== p.weekStart)) return null

  const employees: ProjectEmployee[] = []
  for (const e of p.employees) {
    if (typeof e?.id !== 'string' || typeof e.name !== 'string' || !isGrid(e.availability)) return null
    const timeOff = normaliseEntries(e.timeOff)
    const pins = normaliseEntries(e.pins)
    if (!timeOff || !pins) return null
    employees.push({ ...e, timeOff, pins })
  }
  return {
    version: 1,
    name: p.name,
    weekStart: p.weekStart ?? mondayOf(today),
    operatingHours: p.operatingHours,
    minCoverage: p.minCoverage,
    shiftRules: { ...shiftRulesOf(DEFAULT_CONFIG), ...p.shiftRules },
    employees,
    rules: normaliseRuleSettings(p.rules),
    threshold: Number.isFinite(p.threshold) ? p.threshold! : 0,
    search: { ...DEFAULT_SEARCH, ...p.search },
  }
}

/** Storage can be missing or throw (private windows, blocked site data) — treat that as empty. */
export function loadProject(storage: Pick<Storage, 'getItem'> | undefined): Project | null {
  try {
    const text = storage?.getItem(STORAGE_KEY)
    return text ? normaliseProject(JSON.parse(text)) : null
  } catch {
    return null
  }
}

export function saveProject(storage: Pick<Storage, 'setItem'> | undefined, project: Project): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(project))
    return storage !== undefined
  } catch {
    return false
  }
}
