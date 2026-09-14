import {
  addDays,
  isIsoDate,
  mondayOf,
  resolveWeek,
  spanIsValid,
  spanSlots,
  spanTiming,
  todayIso,
  weekDayIndex,
  type DatedHours,
  type EmployeeExceptions,
  type IsoDate,
  type TimeSpan,
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
  timeOff: ProjectTimeOff[]
  /** Painted onto the grid a week at a time; stored as contiguous runs per date. */
  pins: ProjectPin[]
}

/** Ids let the editor list and remove entries. */
export interface ProjectTimeOff extends TimeSpan {
  id: string
}

export interface ProjectPin extends DatedHours {
  id: string
}

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
      timeOff: (scenario.exceptions[e.id]?.timeOff ?? []).map((span) => ({ id: newId(), ...span })),
      pins: (scenario.exceptions[e.id]?.pins ?? []).map((pin) => ({ id: newId(), ...pin })),
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
  return Object.fromEntries(
    project.employees.map((e) => [
      e.id,
      {
        timeOff: e.timeOff.map(({ id: _id, ...span }) => span),
        pins: e.pins.map(({ id: _id, ...pin }) => pin),
      },
    ]),
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

/** Applies `change` to one employee, leaving every other employee object untouched. */
function withEmployee(project: Project, id: string, change: (e: ProjectEmployee) => ProjectEmployee): Project {
  return { ...project, employees: project.employees.map((e) => (e.id === id ? change(e) : e)) }
}

/** Adds time off, ignoring a span that isn't valid. */
export function addTimeOff(project: Project, employeeId: string, span: TimeSpan): Project {
  if (!spanIsValid(span)) return project
  return withEmployee(project, employeeId, (e) => ({
    ...e,
    timeOff: [...e.timeOff, { id: newId(), ...span }].sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || a.startHour - b.startHour,
    ),
  }))
}

export function removeTimeOff(project: Project, employeeId: string, id: string): Project {
  return withEmployee(project, employeeId, (e) => ({ ...e, timeOff: e.timeOff.filter((x) => x.id !== id) }))
}

export function removePin(project: Project, employeeId: string, id: string): Project {
  return withEmployee(project, employeeId, (e) => ({ ...e, pins: e.pins.filter((x) => x.id !== id) }))
}

/**
 * Pins or unpins one hour of the week on screen. The date's pins are rebuilt as contiguous runs,
 * so painting 9, 10 and 11 stores a single 9–12 pin and unpinning 10 splits it in two.
 */
export function setPinnedHour(project: Project, employeeId: string, slot: number, pinned: boolean): Project {
  const date = addDays(project.weekStart, Math.floor(slot / HOURS_PER_DAY))
  const hour = slot % HOURS_PER_DAY
  const employee = project.employees.find((e) => e.id === employeeId)
  if (!employee) return project

  const hours = new Array<boolean>(HOURS_PER_DAY).fill(false)
  for (const pin of employee.pins) {
    if (pin.date === date) for (let h = pin.startHour; h < pin.endHour; h++) hours[h] = true
  }
  if (hours[hour] === pinned) return project
  hours[hour] = pinned

  const runs: ProjectPin[] = []
  let start = -1
  for (let h = 0; h <= HOURS_PER_DAY; h++) {
    const set = h < HOURS_PER_DAY && hours[h]
    if (set && start < 0) start = h
    if (!set && start >= 0) {
      runs.push({ id: newId(), date, startHour: start, endHour: h })
      start = -1
    }
  }
  return withEmployee(project, employeeId, (e) => ({
    ...e,
    pins: [...e.pins.filter((p) => p.date !== date), ...runs].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour,
    ),
  }))
}

/** Removes the employee's pins dated in the week on screen; other weeks' pins stay. */
export function clearWeekPins(project: Project, employeeId: string): Project {
  return withEmployee(project, employeeId, (e) => ({
    ...e,
    pins: e.pins.filter((p) => weekDayIndex(project.weekStart, p.date) === null),
  }))
}

/** Column headers for the project's week: `'Mon 21'`. */
export function weekDayLabels(project: Project): string[] {
  return DAY_NAMES.map((name, day) => `${name} ${Number(addDays(project.weekStart, day).slice(8))}`)
}

/** 168-entry grids marking which hours this week's time off and pins cover for `employee`. */
export function weekMarks(project: Project, employee: ProjectEmployee): { timeOff: boolean[]; pinned: boolean[] } {
  const timeOff = new Array<boolean>(WEEK_HOURS).fill(false)
  for (const span of employee.timeOff) {
    const { from, to } = spanSlots(project.weekStart, span)
    for (let slot = from; slot < to; slot++) timeOff[slot] = true
  }
  const pinned = new Array<boolean>(WEEK_HOURS).fill(false)
  for (const pin of employee.pins) {
    const day = weekDayIndex(project.weekStart, pin.date)
    if (day === null) continue
    for (let hour = pin.startHour; hour < pin.endHour; hour++) pinned[slotIndex(day, hour)] = true
  }
  return { timeOff, pinned }
}

/** Where time off or a pin falls relative to the project's week. */
export function entryTiming(project: Project, entry: TimeSpan | DatedHours): 'past' | 'thisWeek' | 'later' {
  const span: TimeSpan =
    'date' in entry
      ? { startDate: entry.date, startHour: entry.startHour, endDate: entry.date, endHour: entry.endHour }
      : entry
  return spanTiming(project.weekStart, span)
}

// ---------------------------------------------------------------------------
// Persistence.
// ---------------------------------------------------------------------------

export const STORAGE_KEY = 'scheduleMaker.project.v1'

const isDatedHours = (value: unknown): value is DatedHours => {
  const v = value as Partial<DatedHours> | null
  return (
    typeof v === 'object' && v !== null && isIsoDate(v.date) &&
    Number.isInteger(v.startHour) && Number.isInteger(v.endHour) &&
    v.startHour! >= 0 && v.startHour! < v.endHour! && v.endHour! <= HOURS_PER_DAY
  )
}

const entryId = (raw: unknown) => {
  const id = (raw as { id?: unknown }).id
  return typeof id === 'string' ? id : newId()
}

/** Pins from storage, or `null` if any is malformed. A missing list is an older save: empty. */
function normalisePins(raw: unknown): ProjectPin[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || !raw.every(isDatedHours)) return null
  return raw.map((pin) => ({ id: entryId(pin), date: pin.date, startHour: pin.startHour, endHour: pin.endHour }))
}

/**
 * Time off from storage, or `null` if any entry is malformed. Early saves stored single-day
 * `{ date, startHour, endHour }` entries; those become one-day spans.
 */
function normaliseTimeOff(raw: unknown): ProjectTimeOff[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const out: ProjectTimeOff[] = []
  for (const entry of raw) {
    if (isDatedHours(entry)) {
      out.push({ id: entryId(entry), startDate: entry.date, startHour: entry.startHour, endDate: entry.date, endHour: entry.endHour })
      continue
    }
    const span = entry as Partial<TimeSpan> | null
    if (typeof span !== 'object' || span === null) return null
    const candidate = { startDate: span.startDate, startHour: span.startHour, endDate: span.endDate, endHour: span.endHour } as TimeSpan
    if (!spanIsValid(candidate)) return null
    out.push({ id: entryId(entry), ...candidate })
  }
  return out
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
    const timeOff = normaliseTimeOff(e.timeOff)
    const pins = normalisePins(e.pins)
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
