import { validateProblem } from '../config'
import { buildProblemContext } from '../patterns'
import { formatReport, TopKSchedules, type SearchReport, type StopReason } from '../report'
import { defaultRules } from '../rules/builtins'
import { compileRules, scoreBound, scoreComplete } from '../rules/registry'
import type { Rule } from '../rules/types'
import { applyPattern, createState, isComplete, undoPattern, type SearchState } from '../state'
import {
  countBits,
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  type Employee,
  type ProblemContext,
  type ScheduleConfig,
  type Schedule,
  type ShiftBlock,
} from '../types'
import { buildSlotOrder, buildValueOrder, type SlotOrdering } from './ordering'

/** How often to consult the clock. Checking every node would cost more than the search. */
const TIME_CHECK_INTERVAL = 4096

export interface SolveOptions {
  /** Keep schedules scoring at or above this. Default 0. */
  threshold?: number
  /** Rules to score with. Default {@link defaultRules}. */
  rules?: Rule[]
  /** Maximum schedules retained. Default 100. */
  maxResults?: number
  /** Node budget. `Infinity` runs until genuinely exhausted. Default 5,000,000. */
  maxNodes?: number
  /** Wall-clock budget in ms. `Infinity` for no limit. Default 30,000. */
  maxMillis?: number
  /**
   * Once `maxResults` schedules are held, raise the effective pruning floor to the weakest
   * one retained. Dramatically faster, but it changes what "complete" proves: the top-K set
   * rather than *every* schedule above the threshold. Off by default.
   */
  tightenToBest?: boolean
  /**
   * Assert at every leaf that the pruning bound equals the exact score. Catches a rule whose
   * `lowerBound` disagrees with its `final`. Slow; intended for tests and debugging.
   */
  assertBoundsExact?: boolean
  /** Slot decision order. See {@link buildSlotOrder}. Default `'day-major'`. */
  ordering?: SlotOrdering
  signal?: AbortSignal
  /**
   * Called periodically while the search runs. The search is synchronous, so this is the only
   * way a caller (e.g. a Web Worker relaying to a UI) can observe it before it returns.
   */
  onProgress?: (progress: SearchProgress) => void
  /** Minimum ms between `onProgress` calls. Default 250. */
  progressIntervalMs?: number
}

export interface SearchProgress {
  nodesExplored: number
  schedulesFound: number
  /** Best score found so far, or `null` before the first qualifying schedule. */
  bestScore: number | null
  maxDepthReached: number
  slotCount: number
  elapsedMs: number
}

export interface SolveResult {
  schedules: Schedule[]
  report: SearchReport
  ctx: ProblemContext
}

/**
 * Enumerates schedules by branch-and-bound over per-(employee, day) shift patterns.
 *
 * Three prunes, in increasing order of subtlety:
 *
 *  1. **Weekly hours** — assigning this pattern would break a hard `maxWeeklyHours` cap.
 *  2. **Coverage reachability** — some hour can no longer reach its minimum headcount from the
 *     employees still undecided. Always valid; needs no reasoning about scores.
 *  3. **Score bound** — no completion of this branch can reach the threshold. Valid because
 *     rules only subtract, so the node's score is a ceiling for everything beneath it.
 */
export function solve(
  employees: Employee[],
  config: ScheduleConfig,
  options: SolveOptions = {},
): SolveResult {
  const {
    threshold = 0,
    rules = defaultRules(),
    maxResults = 100,
    maxNodes = 5_000_000,
    maxMillis = 30_000,
    tightenToBest = false,
    assertBoundsExact = false,
    ordering = 'day-major',
    signal,
    onProgress,
    progressIntervalMs = 250,
  } = options

  validateProblem(employees, config)

  const ctx = buildProblemContext(employees, config)
  const ruleSet = compileRules(rules, ctx, threshold)
  const order = buildSlotOrder(ctx, ordering)
  const valueOrder = buildValueOrder(ctx, ruleSet)
  const state = createState(ctx, order, ruleSet.localPenaltyTable)
  const results = new TopKSchedules(maxResults)

  // Reusable per-depth buffers for the coverage-aware candidate ranking, so ordering
  // candidates at every node costs no allocation.
  let widestSlot = 0
  for (const list of ctx.patterns) widestSlot = Math.max(widestSlot, list.length)
  const scratch: Int32Array[] = Array.from(
    { length: order.length },
    () => new Int32Array(widestSlot),
  )

  let nodesExplored = 0
  let maxDepthReached = 0
  let prunedByCoverage = 0
  let prunedByScore = 0
  let prunedByHours = 0
  let schedulesFound = 0
  let bestScore: number | null = null
  let stopReason: StopReason = 'exhausted'
  let stopped = false

  const startedAt = Date.now()
  let lastProgressAt = startedAt

  const reportProgress = (now: number): void => {
    lastProgressAt = now
    onProgress!({
      nodesExplored,
      schedulesFound,
      bestScore,
      maxDepthReached,
      slotCount: order.length,
      elapsedMs: now - startedAt,
    })
  }

  const effectiveThreshold = (): number =>
    tightenToBest ? Math.max(threshold, nextAbove(results.worstKeptScore)) : threshold

  const budgetExhausted = (): boolean => {
    if (nodesExplored >= maxNodes) {
      stopReason = 'nodeBudget'
      return true
    }
    if (nodesExplored % TIME_CHECK_INTERVAL === 0) {
      const now = Date.now()
      if (now - startedAt >= maxMillis) {
        stopReason = 'timeBudget'
        return true
      }
      if (onProgress && now - lastProgressAt >= progressIntervalMs) reportProgress(now)
    }
    if (signal?.aborted) {
      stopReason = 'aborted'
      return true
    }
    return false
  }

  const recordLeaf = (): void => {
    const { score, penalties } = scoreComplete(state.patternAt, ruleSet, ctx)

    if (assertBoundsExact) {
      const bound = scoreBound(state, ruleSet, ctx)
      if (Math.abs(bound - score) > 1e-9) {
        throw new Error(
          `Bound/score mismatch at a complete schedule: bound ${bound}, exact ${score}. ` +
            `A rule's lowerBound disagrees with its final — pruning is unsound.`,
        )
      }
    }

    if (score < threshold) return
    schedulesFound++
    if (bestScore === null || score > bestScore) bestScore = score
    results.offer(materialiseSchedule(state.patternAt, score, penalties, ctx))
  }

  const descend = (): void => {
    if (stopped) return
    if (isComplete(state)) {
      recordLeaf()
      return
    }

    const slot = order[state.depth]
    const employee = Math.floor(slot / DAYS_PER_WEEK)
    const maxWeekly = ctx.employees[employee].maxWeeklyHours
    const patterns = ctx.patterns[slot]
    const candidates = rankCandidates(state, slot, valueOrder[slot], scratch[state.depth])

    for (let i = 0; i < candidates.length; i++) {
      if (stopped) return
      const patternIndex = candidates[i]

      if (state.employeeHours[employee] + patterns[patternIndex].hours > maxWeekly) {
        prunedByHours++
        continue
      }

      applyPattern(state, patternIndex)
      nodesExplored++
      if (state.depth > maxDepthReached) maxDepthReached = state.depth

      if (budgetExhausted()) {
        stopped = true
        undoPattern(state)
        return
      }

      if (state.negativeSlack > 0) {
        prunedByCoverage++
      } else if (scoreBound(state, ruleSet, ctx) < effectiveThreshold()) {
        prunedByScore++
      } else {
        descend()
      }

      undoPattern(state)
    }
  }

  descend()
  if (onProgress) reportProgress(Date.now())

  let patternCount = 0
  for (const list of ctx.patterns) patternCount += list.length

  const report: SearchReport = {
    complete: !stopped,
    provenScope: tightenToBest ? 'top-k' : 'all-above-threshold',
    stopReason,
    threshold,
    nodesExplored,
    maxDepthReached,
    slotCount: order.length,
    prunedByCoverage,
    prunedByScore,
    prunedByHours,
    schedulesFound,
    schedulesKept: results.size,
    schedulesDropped: results.droppedCount,
    elapsedMs: Date.now() - startedAt,
    patternCount,
  }

  return { schedules: results.drain(), report, ctx }
}

export interface Calibration {
  /** Best score actually reached, or `null` if no complete schedule was found in budget. */
  bestScore: number | null
  /** A threshold that admits the best schedules found. `null` when `bestScore` is `null`. */
  suggestedThreshold: number | null
  report: SearchReport
}

/**
 * Finds the best score actually achievable, to calibrate a threshold against.
 *
 * Worth doing because scores are `100 - (total penalty)`, and penalties are absolute counts:
 * one non-preferred hour costs the same whether the roster is 3 people or 30. A large week
 * therefore accumulates far more penalty and scores well below 100 even when the schedule is
 * good. There is no universal "good score" — the achievable range depends on the roster, the
 * coverage demand, and the weights, so measure it rather than guessing.
 *
 * Runs with the incumbent-tightening search, which optimises hard instead of enumerating.
 */
export function calibrate(
  employees: Employee[],
  config: ScheduleConfig,
  options: Omit<SolveOptions, 'threshold' | 'tightenToBest' | 'maxResults'> = {},
): Calibration {
  const { schedules, report } = solve(employees, config, {
    ...options,
    threshold: -Infinity,
    tightenToBest: true,
    maxResults: 1,
  })
  if (schedules.length === 0) return { bestScore: null, suggestedThreshold: null, report }
  const bestScore = schedules[0].score
  // A little headroom below the best, so the threshold admits a band of good schedules
  // rather than only the single optimum.
  const headroom = Math.max(5, Math.abs(bestScore) * 0.1)
  return {
    bestScore,
    suggestedThreshold: Math.round(bestScore - headroom),
    report,
  }
}

/** Gain buckets are hour counts, so 0..24 inclusive. */
const GAIN_BUCKETS = HOURS_PER_DAY + 1
const bucketCounts = new Int32Array(GAIN_BUCKETS)
const bucketOffsets = new Int32Array(GAIN_BUCKETS)
const candidateGain = new Int32Array(1024)

/**
 * Orders this slot's candidate patterns by how many still-understaffed hours they would fill,
 * most first, falling back to the static cheapest-penalty order within each tier.
 *
 * Without this the search tries the empty "day off" pattern first everywhere, because it is
 * always the cheapest — and then spends millions of nodes backtracking out of rosters that
 * were never going to meet coverage. Diving toward feasibility first is what lets a realistic
 * problem reach a complete schedule at all.
 *
 * Bucketed by gain rather than sorted (gains are small integers), so this is O(patterns) and
 * writes into a caller-owned per-depth buffer — no allocation per node.
 */
function rankCandidates(
  state: SearchState,
  slot: number,
  staticOrder: Int32Array,
  out: Int32Array,
): Int32Array {
  const { ctx } = state
  const day = slot % DAYS_PER_WEEK
  const dayBase = day * HOURS_PER_DAY

  let deficitMask = 0
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    const idx = dayBase + hour
    if (state.coverage[idx] < ctx.config.minCoverage[idx]) deficitMask |= 1 << hour
  }
  // Nothing left to cover today: the static cheapest-first order is already what we want.
  if (deficitMask === 0) return staticOrder

  const patterns = ctx.patterns[slot]
  const n = staticOrder.length
  const gains = n <= candidateGain.length ? candidateGain : new Int32Array(n)

  bucketCounts.fill(0)
  for (let i = 0; i < n; i++) {
    const gain = countBits(patterns[staticOrder[i]].mask & deficitMask)
    gains[i] = gain
    bucketCounts[gain]++
  }

  // Descending gain: bucket g starts after every bucket above it.
  bucketOffsets[GAIN_BUCKETS - 1] = 0
  for (let g = GAIN_BUCKETS - 2; g >= 0; g--) {
    bucketOffsets[g] = bucketOffsets[g + 1] + bucketCounts[g + 1]
  }
  for (let i = 0; i < n; i++) out[bucketOffsets[gains[i]]++] = staticOrder[i]

  return out.subarray(0, n)
}

/**
 * Smallest score strictly better than `score`, used when `tightenToBest` raises the floor.
 * Scores are weighted sums of integer penalty counts, so nudging by a small epsilon is enough
 * to exclude ties without risking the exclusion of a genuinely better schedule.
 */
function nextAbove(score: number): number {
  return score === -Infinity ? -Infinity : score + 1e-9
}

function materialiseSchedule(
  patternAt: Int32Array,
  score: number,
  penalties: Record<string, number>,
  ctx: ProblemContext,
): Schedule {
  const employeeCount = ctx.employees.length
  const blocks: ShiftBlock[][] = []
  const hoursPerEmployee: number[] = []

  for (let e = 0; e < employeeCount; e++) {
    const own: ShiftBlock[] = []
    let hours = 0
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const slot = e * DAYS_PER_WEEK + day
      const pattern = ctx.patterns[slot][patternAt[slot]]
      own.push(...pattern.blocks)
      hours += pattern.hours
    }
    blocks.push(own)
    hoursPerEmployee.push(hours)
  }

  return {
    patternIndices: Int32Array.from(patternAt),
    blocks,
    hoursPerEmployee,
    score,
    penalties,
  }
}

export { formatReport }
