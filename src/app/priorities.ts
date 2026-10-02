import { catalogEntry, type RuleSetting } from '../core/rules/catalog'

/**
 * Plain-language weights for the Priorities step. Each level is a multiple of the rule's
 * default weight, so "Normal" always means what the rule was tuned for.
 */
export type Level = 'off' | 'low' | 'normal' | 'high'

export const LEVELS: { value: Level; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]

const FACTOR: Record<Exclude<Level, 'off'>, number> = { low: 0.5, normal: 1, high: 2 }

/** The level a setting sits at, or `'custom'` for an exact weight that matches none of them. */
export function levelOf(setting: RuleSetting): Level | 'custom' {
  if (!setting.enabled) return 'off'
  const base = catalogEntry(setting.id).defaultWeight
  for (const level of ['low', 'normal', 'high'] as const) {
    if (Math.abs(setting.weight - base * FACTOR[level]) < 1e-9) return level
  }
  return 'custom'
}

/** Turning a rule off keeps its weight, so turning it back on at a level is a clean reset. */
export function applyLevel(setting: RuleSetting, level: Level): RuleSetting {
  if (level === 'off') return { ...setting, enabled: false }
  return { ...setting, enabled: true, weight: catalogEntry(setting.id).defaultWeight * FACTOR[level] }
}
