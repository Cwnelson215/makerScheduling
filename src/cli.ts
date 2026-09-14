import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConfigError } from './core/config'
import { parseScenario, ScenarioError, type ScenarioJson } from './core/io'
import { PatternExplosionError } from './core/patterns'
import { formatReport, formatSchedule } from './core/report'
import { buildRules } from './core/rules/catalog'
import { RuleDefinitionError } from './core/rules/registry'
import { calibrate, solve } from './core/search/solver'

const USAGE = `Usage: npm run solve -- <scenario.json> [options]

Options:
  --threshold <n>    Keep schedules scoring at or above n (overrides the scenario file)
  --max-results <n>  Schedules to retain (default 100)
  --max-nodes <n>    Node budget; "none" for unlimited (default 5000000)
  --max-ms <n>       Time budget in ms; "none" for unlimited (default 30000)
  --tighten          Once full, prune to the best kept score. Much faster, but proves only
                     the top-K rather than every schedule above the threshold.
  --show <n>         Schedules to print (default 3)
  --calibrate        Report the best score actually achievable and suggest a threshold,
                     instead of solving. Scores are 100 minus total penalty, and penalties
                     scale with roster size, so the useful range differs per scenario.
`

function parseArgs(argv: string[]): { file: string; flags: Map<string, string> } {
  const flags = new Map<string, string>()
  let file = ''
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags.set(key, 'true')
      } else {
        flags.set(key, next)
        i++
      }
    } else if (!file) {
      file = arg
    }
  }
  return { file, flags }
}

function numeric(flags: Map<string, string>, key: string, fallback: number): number {
  const raw = flags.get(key)
  if (raw === undefined) return fallback
  if (raw === 'none') return Infinity
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`--${key} expects a number or "none", got "${raw}"`)
  return value
}

function main(): void {
  const { file, flags } = parseArgs(process.argv.slice(2))
  if (!file) {
    process.stdout.write(USAGE)
    process.exit(1)
  }

  const path = resolve(process.cwd(), file)
  const json = JSON.parse(readFileSync(path, 'utf8')) as ScenarioJson
  const scenario = parseScenario(json)

  const threshold = flags.has('threshold')
    ? numeric(flags, 'threshold', scenario.threshold)
    : scenario.threshold

  const budget = {
    rules: buildRules(scenario.rules),
    maxNodes: numeric(flags, 'max-nodes', 5_000_000),
    maxMillis: numeric(flags, 'max-ms', 30_000),
  }

  if (flags.has('calibrate')) {
    process.stdout.write(`${scenario.name} — calibrating…\n\n`)
    const { bestScore, suggestedThreshold, report } = calibrate(
      scenario.employees,
      scenario.config,
      budget,
    )
    process.stdout.write(`${formatReport(report)}\n\n`)
    if (bestScore === null) {
      process.stdout.write(
        'No complete schedule was found within the budget. The roster may be infeasible, ' +
          'or the budget may be too small.\n',
      )
    } else {
      process.stdout.write(
        `best score found   ${bestScore}\n` +
          `suggested threshold ${suggestedThreshold}\n` +
          (report.complete
            ? 'This is the true optimum — the search completed.\n'
            : 'Search was truncated, so a better schedule may exist.\n'),
      )
    }
    return
  }

  process.stdout.write(
    `${scenario.name} — ${scenario.employees.length} employees, threshold ${threshold}\n\n`,
  )

  const { schedules, report, ctx } = solve(scenario.employees, scenario.config, {
    threshold,
    maxResults: numeric(flags, 'max-results', 100),
    ...budget,
    tightenToBest: flags.has('tighten'),
  })

  process.stdout.write(`${formatReport(report)}\n`)

  const show = Math.min(numeric(flags, 'show', 3), schedules.length)
  if (show > 0) {
    process.stdout.write(`\nTop ${show} of ${schedules.length} retained:\n\n`)
    for (let i = 0; i < show; i++) {
      process.stdout.write(`#${i + 1}  ${formatSchedule(schedules[i], ctx)}\n\n`)
    }
  }
}

try {
  main()
} catch (error) {
  if (
    error instanceof ConfigError ||
    error instanceof ScenarioError ||
    error instanceof PatternExplosionError ||
    error instanceof RuleDefinitionError
  ) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
  throw error
}
