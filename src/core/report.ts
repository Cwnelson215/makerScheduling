import { fmtHour } from './config'
import { DAY_NAMES, DAYS_PER_WEEK, type ProblemContext, type Schedule } from './types'

/**
 * Bounded top-K store, kept as a min-heap so the weakest retained schedule is always at the
 * root and cheap to evict.
 *
 * "Every schedule above the threshold" can run to millions of near-identical variants, which
 * would exhaust memory long before the search space was exhausted. {@link droppedCount} records
 * how many above-threshold schedules were discarded, so a capped result set never masquerades
 * as the complete set.
 */
export class TopKSchedules {
  private heap: Schedule[] = []
  private dropped = 0

  constructor(readonly capacity: number) {
    if (capacity < 1) throw new Error('TopKSchedules capacity must be at least 1')
  }

  get size(): number {
    return this.heap.length
  }

  get droppedCount(): number {
    return this.dropped
  }

  /** Score of the weakest retained schedule, or -Infinity while below capacity. */
  get worstKeptScore(): number {
    return this.heap.length < this.capacity ? -Infinity : this.heap[0].score
  }

  offer(schedule: Schedule): void {
    if (this.heap.length < this.capacity) {
      this.heap.push(schedule)
      this.siftUp(this.heap.length - 1)
      return
    }
    this.dropped++
    if (schedule.score <= this.heap[0].score) return
    this.heap[0] = schedule
    this.siftDown(0)
  }

  /** Retained schedules, best score first. */
  drain(): Schedule[] {
    return [...this.heap].sort((a, b) => b.score - a.score)
  }

  private siftUp(start: number): void {
    let i = start
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.heap[parent].score <= this.heap[i].score) break
      ;[this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]]
      i = parent
    }
  }

  private siftDown(start: number): void {
    let i = start
    const n = this.heap.length
    for (;;) {
      const left = i * 2 + 1
      const right = left + 1
      let smallest = i
      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right
      if (smallest === i) break
      ;[this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]]
      i = smallest
    }
  }
}

export type StopReason = 'exhausted' | 'nodeBudget' | 'timeBudget' | 'aborted'

export interface SearchReport {
  /**
   * True only when the pruned tree was explored to the end. When true, the returned set is
   * provably every schedule at or above the threshold (up to `maxResults`). When false, better
   * schedules may exist in the unexplored remainder.
   */
  complete: boolean
  /**
   * What a `complete` search actually establishes.
   *
   * `'all-above-threshold'` — the returned set is every schedule at or above the threshold.
   * `'top-k'` — incumbent tightening was on, so branches that could only produce schedules
   * worse than the weakest retained one were cut. The best `maxResults` are proven correct,
   * but the set is *not* every qualifying schedule.
   */
  provenScope: 'all-above-threshold' | 'top-k'
  stopReason: StopReason
  threshold: number
  nodesExplored: number
  /** Deepest point reached, against `slotCount`. A search stuck well short of the total is
   * thrashing on an over-constrained problem rather than merely running out of budget. */
  maxDepthReached: number
  slotCount: number
  prunedByCoverage: number
  prunedByScore: number
  prunedByHours: number
  /** Complete schedules found at or above the threshold, including any dropped by the cap. */
  schedulesFound: number
  schedulesKept: number
  schedulesDropped: number
  elapsedMs: number
  /** Total legal day-patterns enumerated across all (employee, day) slots. */
  patternCount: number
}

export function formatReport(report: SearchReport): string {
  const n = (x: number) => x.toLocaleString('en-US')
  const pruned = report.prunedByCoverage + report.prunedByScore + report.prunedByHours

  const header = report.complete
    ? report.provenScope === 'all-above-threshold'
      ? '✓ SEARCH COMPLETE — every schedule at or above the threshold was found'
      : `✓ SEARCH COMPLETE — the best ${n(report.schedulesKept)} are proven optimal ` +
        '(incumbent tightening was on, so this is NOT every qualifying schedule)'
    : `⚠ SEARCH TRUNCATED — stopped on ${describeStop(report.stopReason)}`

  const lines = [
    header,
    `  threshold        ${report.threshold}`,
    `  nodes explored   ${n(report.nodesExplored)}`,
    `  branches pruned  ${n(pruned)}  ` +
      `(coverage ${n(report.prunedByCoverage)}, score ${n(report.prunedByScore)}, ` +
      `hours ${n(report.prunedByHours)})`,
    `  depth reached    ${report.maxDepthReached} of ${report.slotCount} slots`,
    `  patterns         ${n(report.patternCount)}`,
    `  elapsed          ${report.elapsedMs}ms`,
    `  schedules        ${n(report.schedulesFound)} at or above threshold, ` +
      `${n(report.schedulesKept)} retained`,
  ]

  if (report.schedulesDropped > 0 && report.provenScope === 'all-above-threshold') {
    lines.push(
      `  ⚠ ${n(report.schedulesDropped)} above-threshold schedule(s) discarded by the ` +
        `result cap — raise maxResults to retain more.`,
    )
  }
  if (!report.complete) {
    lines.push('  ⚠ Better schedules may exist in the unexplored remainder.')
  }
  if (report.complete && report.schedulesFound === 0) {
    lines.push('  No schedule can reach this threshold. Lower it or relax the rules.')
  }

  return lines.join('\n')
}

function describeStop(reason: StopReason): string {
  switch (reason) {
    case 'nodeBudget':
      return 'the node budget'
    case 'timeBudget':
      return 'the time budget'
    case 'aborted':
      return 'caller abort'
    case 'exhausted':
      return 'exhaustion'
  }
}

/** Renders one schedule as a per-employee week summary. */
export function formatSchedule(schedule: Schedule, ctx: ProblemContext): string {
  const lines = [`score ${schedule.score.toFixed(1)}`]
  for (let e = 0; e < ctx.employees.length; e++) {
    const byDay: string[] = []
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const blocks = schedule.blocks[e].filter((b) => b.day === day)
      if (blocks.length === 0) continue
      const spans = blocks.map((b) => `${fmtHour(b.startHour)}-${fmtHour(b.endHour)}`).join(' + ')
      byDay.push(`${DAY_NAMES[day]} ${spans}`)
    }
    const hours = `${schedule.hoursPerEmployee[e]}h`.padStart(4)
    lines.push(
      `  ${ctx.employees[e].name.padEnd(12)} ${hours}  ${byDay.join(', ') || '(not scheduled)'}`,
    )
  }
  const charged = Object.entries(schedule.penalties).filter(([, v]) => v > 0)
  if (charged.length > 0) {
    lines.push(`  penalties: ${charged.map(([k, v]) => `${k} -${v}`).join(', ')}`)
  }
  return lines.join('\n')
}
