import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveWeek, type EmployeeExceptions } from '../src/core/calendar'
import { parseScenario, type Scenario, type ScenarioJson } from '../src/core/io'
import { scoreComplete } from '../src/core/rules/registry'
import type { CompiledRuleSet, Rule } from '../src/core/rules/types'
import type { SearchState } from '../src/core/state'
import {
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  WEEK_HOURS,
  type Employee,
  type ProblemContext,
  type ScheduleConfig,
} from '../src/core/types'

export function loadFixture(name: string): Scenario {
  const path = resolve(__dirname, '../src/fixtures', name)
  return parseScenario(JSON.parse(readFileSync(path, 'utf8')) as ScenarioJson)
}

/** Monday of the week the dated fixture exceptions below are written against. */
export const FIXTURE_WEEK = '2026-09-21'

/**
 * Dated exceptions for `small-cafe.json` (open Mon and Tue, 9am–3pm), exercising every kind:
 * a pin that removes Ana's Monday day-off and forces an early start, whole-day time off for
 * Ben on Tuesday, a single pinned hour for Cleo that several shifts can cover, and an entry
 * dated outside the week that must be ignored.
 */
export const SMALL_CAFE_EXCEPTIONS: Record<string, EmployeeExceptions> = {
  ana: {
    pins: [{ date: '2026-09-21', startHour: 9, endHour: 11 }],
    timeOff: [{ date: '2026-09-30', startHour: 0, endHour: 24 }],
  },
  ben: { pins: [], timeOff: [{ date: '2026-09-22', startHour: 0, endHour: 24 }] },
  cleo: { pins: [{ date: '2026-09-22', startHour: 13, endHour: 14 }], timeOff: [] },
}

/** `small-cafe.json` with {@link SMALL_CAFE_EXCEPTIONS} applied for {@link FIXTURE_WEEK}. */
export function loadPinnedSmallCafe(): { employees: Employee[]; config: ScheduleConfig } {
  const { employees, config } = loadFixture('small-cafe.json')
  return { employees: resolveWeek(employees, FIXTURE_WEEK, SMALL_CAFE_EXCEPTIONS), config }
}

/** Deterministic LCG, so a failing property test reproduces exactly from its seed. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * Uniform view of a rule's lower bound, whether the rule is local or global.
 *
 * Local rules have no `lowerBound` of their own — their penalty is folded into the state's
 * running `localPenalty` total. Summing their per-pattern penalty over the decided slots
 * reproduces exactly that contribution, letting the monotonicity property be asserted for
 * every rule with one code path.
 */
export function ruleLowerBound(rule: Rule, state: SearchState, ctx: ProblemContext): number {
  if (rule.lowerBound) return rule.lowerBound(state, ctx)
  let total = 0
  for (let slot = 0; slot < ctx.patterns.length; slot++) {
    const index = state.patternAt[slot]
    if (index < 0) continue
    total += rule.patternPenalty!(
      ctx.patterns[slot][index],
      Math.floor(slot / DAYS_PER_WEEK),
      slot % DAYS_PER_WEEK,
      ctx,
    )
  }
  return total
}

export function meetsCoverage(indices: Int32Array, ctx: ProblemContext): boolean {
  const coverage = new Int32Array(WEEK_HOURS)
  for (let slot = 0; slot < indices.length; slot++) {
    const day = slot % DAYS_PER_WEEK
    const mask = ctx.patterns[slot][indices[slot]].mask
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      if (mask & (1 << hour)) coverage[day * HOURS_PER_DAY + hour]++
    }
  }
  for (let i = 0; i < WEEK_HOURS; i++) {
    if (coverage[i] < ctx.config.minCoverage[i]) return false
  }
  return true
}

export function withinWeeklyHours(indices: Int32Array, ctx: ProblemContext): boolean {
  for (let e = 0; e < ctx.employees.length; e++) {
    let hours = 0
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      hours += ctx.patterns[e * DAYS_PER_WEEK + day][indices[e * DAYS_PER_WEEK + day]].hours
    }
    if (hours > ctx.employees[e].maxWeeklyHours) return false
  }
  return true
}

export interface BruteForceHit {
  key: string
  score: number
}

/**
 * Enumerates the entire cartesian product of day-patterns with no pruning whatsoever, keeping
 * every combination that satisfies the hard constraints and reaches the threshold.
 *
 * This is the ground truth the branch-and-bound solver is checked against. It is deliberately
 * naive — it shares the scoring code but none of the search logic, so a bug in the bound, the
 * incremental state, or the ordering shows up as a difference in the two result sets.
 */
export function bruteForce(
  ctx: ProblemContext,
  ruleSet: CompiledRuleSet,
  threshold: number,
): BruteForceHit[] {
  const slotCount = ctx.patterns.length
  const indices = new Int32Array(slotCount)
  const hits: BruteForceHit[] = []

  const recurse = (slot: number): void => {
    if (slot === slotCount) {
      if (!meetsCoverage(indices, ctx)) return
      if (!withinWeeklyHours(indices, ctx)) return
      const { score } = scoreComplete(indices, ruleSet, ctx)
      if (score >= threshold) hits.push({ key: indices.join(','), score })
      return
    }
    const options = ctx.patterns[slot].length
    for (let p = 0; p < options; p++) {
      indices[slot] = p
      recurse(slot + 1)
    }
  }

  recurse(0)
  return hits
}

/** Total number of combinations brute force must visit — guards against a runaway fixture. */
export function searchSpaceSize(ctx: ProblemContext): number {
  let size = 1
  for (const list of ctx.patterns) size *= list.length
  return size
}
