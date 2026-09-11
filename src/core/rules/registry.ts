import type { SearchState } from '../state'
import { DAYS_PER_WEEK, MAX_SCORE, type ProblemContext } from '../types'
import type { CompiledRuleSet, Rule } from './types'

export class RuleDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleDefinitionError'
  }
}

/**
 * Splits rules into local and global, and precomputes the local penalty of every
 * (slot, pattern) pair once so the inner search loop only ever does a table lookup.
 */
export function compileRules(
  rules: Rule[],
  ctx: ProblemContext,
  threshold: number,
): CompiledRuleSet {
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new RuleDefinitionError(`duplicate rule id "${rule.id}"`)
    seen.add(rule.id)
    const isLocal = typeof rule.patternPenalty === 'function'
    const isGlobal = typeof rule.lowerBound === 'function'
    if (isLocal === isGlobal) {
      throw new RuleDefinitionError(
        `rule "${rule.id}" must define exactly one of patternPenalty (local) or ` +
          `lowerBound (global); it defines ${isLocal ? 'both' : 'neither'}`,
      )
    }
    if (rule.weight < 0) {
      throw new RuleDefinitionError(
        `rule "${rule.id}" has negative weight ${rule.weight}. Weights must be >= 0 — a ` +
          `negative weight would turn a penalty into a reward and break the pruning bound.`,
      )
    }
  }

  const localRules = rules.filter((r) => r.patternPenalty)
  const globalRules = rules.filter((r) => r.lowerBound)

  const localPenaltyTable: Float64Array[] = new Array(ctx.patterns.length)
  for (let slot = 0; slot < ctx.patterns.length; slot++) {
    const employee = Math.floor(slot / DAYS_PER_WEEK)
    const day = slot % DAYS_PER_WEEK
    const list = ctx.patterns[slot]
    const table = new Float64Array(list.length)
    for (let p = 0; p < list.length; p++) {
      let total = 0
      for (const rule of localRules) {
        total += rule.weight * rule.patternPenalty!(list[p], employee, day, ctx)
      }
      table[p] = total
    }
    localPenaltyTable[slot] = table
  }

  return { rules, globalRules, localRules, localPenaltyTable, threshold }
}

/**
 * Upper bound on the score of any complete schedule below `state`.
 *
 * Local penalties are already accumulated exactly; global rules contribute their monotone
 * lower bound. Since every term only grows as the search descends, this value only falls —
 * which is what licenses pruning the whole subtree when it drops below the threshold.
 */
export function scoreBound(
  state: SearchState,
  ruleSet: CompiledRuleSet,
  ctx: ProblemContext,
): number {
  let penalty = state.localPenalty
  for (const rule of ruleSet.globalRules) {
    penalty += rule.weight * rule.lowerBound!(state, ctx)
  }
  return MAX_SCORE - penalty
}

export interface ScoreBreakdown {
  score: number
  penalties: Record<string, number>
}

/** Exact score of a fully-assigned schedule, with the per-rule weighted penalties. */
export function scoreComplete(
  patternIndices: Int32Array,
  ruleSet: CompiledRuleSet,
  ctx: ProblemContext,
): ScoreBreakdown {
  const penalties: Record<string, number> = {}
  let total = 0
  for (const rule of ruleSet.rules) {
    const weighted = rule.weight * rule.final(patternIndices, ctx)
    penalties[rule.id] = weighted
    total += weighted
  }
  return { score: MAX_SCORE - total, penalties }
}
