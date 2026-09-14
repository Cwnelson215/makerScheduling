import {
  clopenRule,
  consecutiveDaysRule,
  evenDistributionRule,
  nonPreferredHourRule,
  overCoverageRule,
  overTargetHoursRule,
  shortShiftRule,
  splitShiftRule,
  underTargetHoursRule,
} from './builtins'
import type { Rule } from './types'

export type BuiltinRuleId =
  | 'nonPreferredHour'
  | 'splitShift'
  | 'shortShift'
  | 'overCoverage'
  | 'underTargetHours'
  | 'overTargetHours'
  | 'consecutiveDays'
  | 'clopen'
  | 'evenDistribution'

/**
 * Plain-data description of one rule as an admin configured it.
 *
 * Rules themselves carry functions, which cannot be saved to storage or posted to a Web Worker.
 * Settings can — and {@link buildRules} turns them back into rules wherever the solver runs.
 */
export interface RuleSetting {
  id: BuiltinRuleId
  enabled: boolean
  weight: number
  /** `shortShift` only: blocks shorter than this many hours are penalised. */
  comfortableLength?: number
}

export interface RuleCatalogEntry {
  id: BuiltinRuleId
  label: string
  /** What one unit of penalty is, in the admin's terms. */
  unit: string
  description: string
  defaultWeight: number
  /** How early the rule's bound starts pruning. See README § Rules. */
  bound: 'tight' | 'weak'
  build: (setting: RuleSetting) => Rule
}

export const DEFAULT_COMFORTABLE_LENGTH = 4

export const RULE_CATALOG: readonly RuleCatalogEntry[] = [
  {
    id: 'nonPreferredHour',
    label: 'Not-preferred hours',
    unit: 'per hour',
    description: 'Hours worked in a slot the employee marked not preferred.',
    defaultWeight: 1,
    bound: 'tight',
    build: (s) => nonPreferredHourRule(s.weight),
  },
  {
    id: 'splitShift',
    label: 'Split shifts',
    unit: 'per split day',
    description: 'Days where an employee works two or more separate blocks.',
    defaultWeight: 3,
    bound: 'tight',
    build: (s) => splitShiftRule(s.weight),
  },
  {
    id: 'shortShift',
    label: 'Short shifts',
    unit: 'per block',
    description: 'Blocks that are legal but shorter than a comfortable length.',
    defaultWeight: 2,
    bound: 'tight',
    build: (s) => shortShiftRule(s.weight, s.comfortableLength ?? DEFAULT_COMFORTABLE_LENGTH),
  },
  {
    id: 'overCoverage',
    label: 'Over-staffing',
    unit: 'per extra staffed hour',
    description: 'Staffed hours beyond the minimum headcount — a proxy for labor cost.',
    defaultWeight: 1,
    bound: 'tight',
    build: (s) => overCoverageRule(s.weight),
  },
  {
    id: 'underTargetHours',
    label: 'Below target hours',
    unit: 'per hour short',
    description: 'Hours an employee finishes below their weekly target.',
    defaultWeight: 2,
    bound: 'weak',
    build: (s) => underTargetHoursRule(s.weight),
  },
  {
    id: 'overTargetHours',
    label: 'Above target hours',
    unit: 'per hour over',
    description: 'Hours an employee finishes above their weekly target.',
    defaultWeight: 2,
    bound: 'tight',
    build: (s) => overTargetHoursRule(s.weight),
  },
  {
    id: 'consecutiveDays',
    label: 'Too many days in a row',
    unit: 'per extra day',
    description: 'Days worked beyond the consecutive-day limit.',
    defaultWeight: 5,
    bound: 'weak',
    build: (s) => consecutiveDaysRule(s.weight),
  },
  {
    id: 'clopen',
    label: 'Close-then-open',
    unit: 'per turnaround',
    description: 'Closing one night and opening the next morning.',
    defaultWeight: 8,
    bound: 'tight',
    build: (s) => clopenRule(s.weight),
  },
  {
    id: 'evenDistribution',
    label: 'Uneven hours',
    unit: 'per hour of spread',
    description: 'Gap between the most and least scheduled employee.',
    defaultWeight: 1,
    bound: 'weak',
    build: (s) => evenDistributionRule(s.weight),
  },
]

const CATALOG_BY_ID = new Map(RULE_CATALOG.map((entry) => [entry.id, entry]))

export function catalogEntry(id: BuiltinRuleId): RuleCatalogEntry {
  const entry = CATALOG_BY_ID.get(id)
  if (!entry) throw new Error(`unknown rule id "${id}"`)
  return entry
}

export function defaultRuleSettings(): RuleSetting[] {
  return RULE_CATALOG.map((entry) => ({
    id: entry.id,
    enabled: true,
    weight: entry.defaultWeight,
    ...(entry.id === 'shortShift' ? { comfortableLength: DEFAULT_COMFORTABLE_LENGTH } : {}),
  }))
}

/**
 * Fills in any catalog rule missing from `saved` with its defaults, drops unknown ids, and
 * returns settings in catalog order. Lets older saved projects keep working as rules are added.
 */
export function normaliseRuleSettings(saved: readonly Partial<RuleSetting>[] | undefined): RuleSetting[] {
  const byId = new Map<string, Partial<RuleSetting>>()
  for (const setting of saved ?? []) if (setting.id) byId.set(setting.id, setting)
  return defaultRuleSettings().map((fallback) => {
    const stored = byId.get(fallback.id)
    if (!stored) return fallback
    const weight = Number.isFinite(stored.weight) ? Math.max(0, stored.weight!) : fallback.weight
    return {
      ...fallback,
      enabled: stored.enabled ?? fallback.enabled,
      weight,
      ...(fallback.id === 'shortShift'
        ? { comfortableLength: stored.comfortableLength ?? fallback.comfortableLength }
        : {}),
    }
  })
}

/** Turns enabled settings into rules. Disabled rules are left out entirely. */
export function buildRules(settings: readonly RuleSetting[]): Rule[] {
  return settings.filter((s) => s.enabled).map((s) => catalogEntry(s.id).build(s))
}
