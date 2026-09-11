import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULT_CONFIG, uniformCoverage, validateProblem } from '../src/core/config'
import { parseScenario, ScenarioError, type ScenarioJson } from '../src/core/io'
import { defaultRules, nonPreferredHourRule } from '../src/core/rules/builtins'
import { buildProblemContext } from '../src/core/patterns'
import { compileRules, RuleDefinitionError } from '../src/core/rules/registry'
import {
  Availability,
  DAYS_PER_WEEK,
  WEEK_HOURS,
  slotIndex,
  type Employee,
  type ScheduleConfig,
} from '../src/core/types'
import { loadFixture } from './helpers'

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  const availability = new Uint8Array(WEEK_HOURS).fill(Availability.Preferred)
  return {
    id: 'a',
    name: 'A',
    maxWeeklyHours: 40,
    targetWeeklyHours: 20,
    availability,
    ...overrides,
  }
}

const openWeek: ScheduleConfig = {
  ...DEFAULT_CONFIG,
  operatingHours: Array.from({ length: DAYS_PER_WEEK }, () => ({ startHour: 9, endHour: 17 })),
}

/**
 * Validation exists so an impossible roster fails in milliseconds with a readable reason,
 * rather than after a long search that finds nothing and cannot say why.
 */
describe('problem validation', () => {
  const expectProblem = (employees: Employee[], config: ScheduleConfig, fragment: string) => {
    try {
      validateProblem(employees, config)
      throw new Error(`expected validation to fail with a message containing "${fragment}"`)
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const problems = (error as ConfigError).problems.join('\n')
      expect(problems).toContain(fragment)
    }
  }

  it('accepts a well-formed problem', () => {
    expect(() =>
      validateProblem([makeEmployee()], { ...openWeek, minCoverage: uniformCoverage(openWeek.operatingHours, 1) }),
    ).not.toThrow()
  })

  it('rejects an empty roster', () => {
    expectProblem([], openWeek, 'no employees')
  })

  it('rejects duplicate employee ids', () => {
    expectProblem([makeEmployee(), makeEmployee()], openWeek, 'duplicate employee id')
  })

  it('rejects a target above the hard weekly maximum', () => {
    expectProblem(
      [makeEmployee({ maxWeeklyHours: 10, targetWeeklyHours: 20 })],
      openWeek,
      'exceeds',
    )
  })

  it('rejects inverted shift-length bounds', () => {
    expectProblem([makeEmployee()], { ...openWeek, minShiftLength: 8, maxShiftLength: 4 }, 'below minShiftLength')
  })

  it('rejects coverage demanded outside operating hours', () => {
    const minCoverage = new Uint8Array(WEEK_HOURS)
    minCoverage[slotIndex(0, 3)] = 1 // 3am, but the shop opens at 9
    expectProblem([makeEmployee()], { ...openWeek, minCoverage }, 'outside operating hours')
  })

  it('rejects coverage exceeding the number of available bodies', () => {
    const minCoverage = uniformCoverage(openWeek.operatingHours, 3)
    expectProblem([makeEmployee(), makeEmployee({ id: 'b' })], { ...openWeek, minCoverage }, 'only 2 employee(s) are available')
  })

  it('rejects a day open for less than one shift', () => {
    expectProblem(
      [makeEmployee()],
      {
        ...openWeek,
        minShiftLength: 6,
        operatingHours: [{ startHour: 9, endHour: 12 }, ...new Array(6).fill(null)],
      },
      'nobody can be scheduled',
    )
  })

  it('collects every problem, not just the first', () => {
    try {
      validateProblem([], { ...openWeek, minShiftLength: 0, maxBlocksPerDay: 0 })
      throw new Error('expected failure')
    } catch (error) {
      expect((error as ConfigError).problems.length).toBeGreaterThan(2)
    }
  })
})

describe('rule compilation', () => {
  const { employees, config } = loadFixture('small-cafe.json')
  const ctx = buildProblemContext(employees, config)

  it('rejects a rule that is neither local nor global', () => {
    expect(() =>
      compileRules([{ id: 'x', label: 'x', weight: 1, final: () => 0 }], ctx, 0),
    ).toThrow(RuleDefinitionError)
  })

  it('rejects a rule that is both local and global', () => {
    expect(() =>
      compileRules(
        [{ id: 'x', label: 'x', weight: 1, patternPenalty: () => 0, lowerBound: () => 0, final: () => 0 }],
        ctx,
        0,
      ),
    ).toThrow(RuleDefinitionError)
  })

  it('rejects duplicate rule ids', () => {
    expect(() => compileRules([nonPreferredHourRule(), nonPreferredHourRule()], ctx, 0)).toThrow(
      /duplicate rule id/,
    )
  })

  /** A negative weight turns a penalty into a reward, which destroys the pruning ceiling. */
  it('rejects a negative weight', () => {
    expect(() => compileRules([nonPreferredHourRule(-1)], ctx, 0)).toThrow(/negative weight/)
  })

  it('splits rules into local and global correctly', () => {
    const compiled = compileRules(defaultRules(), ctx, 0)
    expect(compiled.localRules.map((r) => r.id).sort()).toEqual([
      'nonPreferredHour',
      'shortShift',
      'splitShift',
    ])
    expect(compiled.globalRules).toHaveLength(6)
    expect(compiled.localPenaltyTable).toHaveLength(ctx.patterns.length)
  })
})

describe('scenario parsing', () => {
  const base: ScenarioJson = {
    config: { operatingHours: { Mon: [9, 17] }, minCoverage: 1 },
    employees: [
      { id: 'a', name: 'A', maxWeeklyHours: 20, targetWeeklyHours: 10, preferred: { Mon: [[9, 17]] } },
    ],
  }

  it('marks unlisted hours as unavailable', () => {
    const { employees } = parseScenario(base)
    expect(employees[0].availability[slotIndex(0, 9)]).toBe(Availability.Preferred)
    expect(employees[0].availability[slotIndex(0, 18)]).toBe(Availability.Unavailable)
    expect(employees[0].availability[slotIndex(1, 9)]).toBe(Availability.Unavailable)
  })

  it('lets not-preferred win over an overlapping preferred range', () => {
    const { employees } = parseScenario({
      ...base,
      employees: [
        {
          ...base.employees[0],
          preferred: { Mon: [[9, 17]] },
          notPreferred: { Mon: [[12, 14]] },
        },
      ],
    })
    expect(employees[0].availability[slotIndex(0, 11)]).toBe(Availability.Preferred)
    expect(employees[0].availability[slotIndex(0, 12)]).toBe(Availability.NotPreferred)
    expect(employees[0].availability[slotIndex(0, 14)]).toBe(Availability.Preferred)
  })

  it('applies a flat headcount only within operating hours', () => {
    const { config } = parseScenario(base)
    expect(config.minCoverage[slotIndex(0, 9)]).toBe(1)
    expect(config.minCoverage[slotIndex(0, 8)]).toBe(0)
    expect(config.minCoverage[slotIndex(1, 9)]).toBe(0)
  })

  it('applies per-range headcounts', () => {
    const { config } = parseScenario({
      ...base,
      config: { operatingHours: { Mon: [9, 17] }, minCoverage: { Mon: [[9, 12, 1], [12, 17, 3]] } },
    })
    expect(config.minCoverage[slotIndex(0, 11)]).toBe(1)
    expect(config.minCoverage[slotIndex(0, 12)]).toBe(3)
  })

  it('rejects an unknown day name', () => {
    expect(() =>
      parseScenario({ ...base, config: { ...base.config, operatingHours: { Munday: [9, 17] } as never } }),
    ).toThrow(ScenarioError)
  })

  it('rejects an out-of-bounds or empty hour range', () => {
    expect(() =>
      parseScenario({ ...base, config: { ...base.config, operatingHours: { Mon: [9, 30] } } }),
    ).toThrow(/out of bounds/)
    expect(() =>
      parseScenario({ ...base, config: { ...base.config, operatingHours: { Mon: [12, 12] } } }),
    ).toThrow(/out of bounds/)
  })

  it('treats a null day as closed', () => {
    const { config } = parseScenario({
      ...base,
      config: { ...base.config, operatingHours: { Mon: [9, 17], Tue: null } },
    })
    expect(config.operatingHours[1]).toBeNull()
  })
})
