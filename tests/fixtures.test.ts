import { describe, expect, it } from 'vitest'
import { formatReport, formatSchedule } from '../src/core/report'
import { solve } from '../src/core/search/solver'
import { Availability, DAYS_PER_WEEK, HOURS_PER_DAY, slotIndex } from '../src/core/types'
import { loadFixture, meetsCoverage, withinWeeklyHours } from './helpers'
import { buildProblemContext } from '../src/core/patterns'

describe('small-cafe fixture', () => {
  const { employees, config, threshold } = loadFixture('small-cafe.json')

  it('solves to completion and proves exhaustiveness', () => {
    const { schedules, report } = solve(employees, config, {
      threshold,
      maxResults: 1_000_000,
      maxNodes: Infinity,
      maxMillis: Infinity,
    })

    expect(report.complete).toBe(true)
    expect(report.stopReason).toBe('exhausted')
    expect(report.maxDepthReached).toBe(report.slotCount)
    expect(schedules.length).toBeGreaterThan(0)
    expect(formatReport(report)).toContain('SEARCH COMPLETE')
  })

  it('returns schedules sorted best-first', () => {
    const { schedules } = solve(employees, config, { threshold, maxNodes: Infinity })
    for (let i = 1; i < schedules.length; i++) {
      expect(schedules[i - 1].score).toBeGreaterThanOrEqual(schedules[i].score)
    }
  })
})

describe('medium-shop fixture', () => {
  const { employees, config, threshold } = loadFixture('medium-shop.json')

  it('truncates under a small budget and says so plainly', () => {
    const { report } = solve(employees, config, { threshold, maxNodes: 50_000 })
    expect(report.complete).toBe(false)
    expect(formatReport(report)).toContain('SEARCH TRUNCATED')
    expect(formatReport(report)).toContain('Better schedules may exist')
  })

  it('still produces valid schedules within a modest budget', () => {
    const { schedules, report } = solve(employees, config, {
      threshold,
      maxNodes: 200_000,
      maxMillis: 20_000,
      tightenToBest: true,
      maxResults: 5,
    })
    expect(schedules.length).toBeGreaterThan(0)
    expect(schedules[0].score).toBeGreaterThanOrEqual(threshold)
    expect(report.maxDepthReached).toBe(report.slotCount)
  })
})

/**
 * Hard constraints are enforced structurally — by generating only legal day-patterns and by
 * pruning — never by scoring. A returned schedule that breaks one is a bug no penalty weight
 * could paper over, so every emitted schedule is re-checked from scratch here.
 */
describe('every returned schedule satisfies the hard constraints', () => {
  for (const fixture of ['small-cafe.json', 'medium-shop.json']) {
    it(fixture, () => {
      const { employees, config, threshold } = loadFixture(fixture)
      const ctx = buildProblemContext(employees, config)
      const { schedules } = solve(employees, config, {
        threshold,
        maxResults: 40,
        maxNodes: 200_000,
        maxMillis: 20_000,
        tightenToBest: true,
      })
      expect(schedules.length).toBeGreaterThan(0)

      for (const schedule of schedules) {
        expect(meetsCoverage(schedule.patternIndices, ctx)).toBe(true)
        expect(withinWeeklyHours(schedule.patternIndices, ctx)).toBe(true)
        expect(schedule.score).toBeGreaterThanOrEqual(threshold)

        for (let e = 0; e < employees.length; e++) {
          const employee = employees[e]
          const perDay = new Map<number, { start: number; end: number }[]>()

          for (const block of schedule.blocks[e]) {
            const length = block.endHour - block.startHour
            expect(length).toBeGreaterThanOrEqual(config.minShiftLength)
            expect(length).toBeLessThanOrEqual(config.maxShiftLength)

            const window = config.operatingHours[block.day]
            expect(window).not.toBeNull()
            expect(block.startHour).toBeGreaterThanOrEqual(window!.startHour)
            expect(block.endHour).toBeLessThanOrEqual(window!.endHour)

            for (let hour = block.startHour; hour < block.endHour; hour++) {
              expect(employee.availability[slotIndex(block.day, hour)]).not.toBe(
                Availability.Unavailable,
              )
            }

            const list = perDay.get(block.day) ?? []
            list.push({ start: block.startHour, end: block.endHour })
            perDay.set(block.day, list)
          }

          for (const [, blocks] of perDay) {
            blocks.sort((a, b) => a.start - b.start)
            expect(blocks.length).toBeLessThanOrEqual(
              config.allowSplitShifts ? config.maxBlocksPerDay : 1,
            )
            let dailyHours = 0
            for (let i = 0; i < blocks.length; i++) {
              dailyHours += blocks[i].end - blocks[i].start
              if (i > 0) {
                expect(blocks[i].start - blocks[i - 1].end).toBeGreaterThanOrEqual(
                  config.minGapBetweenBlocks,
                )
              }
            }
            expect(dailyHours).toBeLessThanOrEqual(config.maxDailyHours)
          }
        }
      }
    })
  }
})

describe('rendering', () => {
  it('formats a schedule with each employee and their hours', () => {
    const { employees, config, threshold } = loadFixture('small-cafe.json')
    const { schedules, ctx } = solve(employees, config, { threshold, maxNodes: Infinity })
    const text = formatSchedule(schedules[0], ctx)
    for (const employee of employees) expect(text).toContain(employee.name)
    expect(text).toContain('score')
  })

  it('reports zero results without pretending the search failed', () => {
    const { employees, config } = loadFixture('small-cafe.json')
    const { schedules, report } = solve(employees, config, {
      threshold: 1000,
      maxNodes: Infinity,
      maxMillis: Infinity,
    })
    expect(schedules).toHaveLength(0)
    expect(report.complete).toBe(true)
    expect(formatReport(report)).toContain('No schedule can reach this threshold')
  })
})

describe('coverage is met exactly where required', () => {
  it('staffs every required hour of the small-cafe week', () => {
    const { employees, config, threshold } = loadFixture('small-cafe.json')
    const { schedules } = solve(employees, config, { threshold, maxNodes: Infinity })

    const coverage = new Int32Array(DAYS_PER_WEEK * HOURS_PER_DAY)
    for (const blocks of schedules[0].blocks) {
      for (const block of blocks) {
        for (let hour = block.startHour; hour < block.endHour; hour++) {
          coverage[slotIndex(block.day, hour)]++
        }
      }
    }
    for (let i = 0; i < coverage.length; i++) {
      expect(coverage[i]).toBeGreaterThanOrEqual(config.minCoverage[i])
    }
  })
})
