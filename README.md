# Schedule Maker

Builds work shift schedules by searching the space of valid rosters, scoring each against
admin-defined rules, and keeping only those above a threshold — abandoning any branch that
provably cannot reach it.

**Status:** solver core, test suite, and a browser UI for editing a roster and building
schedules.

```bash
npm install
npm run dev        # the app, at http://localhost:5173
npm test
npm run solve -- src/fixtures/small-cafe.json   # the same solver from the command line
```

## Using the app

1. **Setup** — the week you're scheduling, opening hours per day, shift-length limits, split
   shifts, and the minimum headcount for each hour (pick a number, then drag across the grid).
2. **Employees** — add people, set target and maximum weekly hours, and paint their usual week
   as preferred, not preferred, or unavailable. The **Pin** and **Unpin** brushes paint shifts
   they must work on the dates of the week shown; use the week arrows to pin another week. Below
   the grid, add **time off** as a start and an end, which can run across several days (see
   [Time off and pins](#time-off-and-pins)).
3. **Scoring** — turn rules on or off and set how many points each one costs.
4. **Solve** — **Find achievable score** measures the best score this roster can reach and
   offers a threshold; **Build schedules** then searches, with live progress. Results show each
   schedule's shifts, where its points went, and staffing by hour. The report says plainly
   whether the search finished or stopped at the time limit.

Everything autosaves in the browser (`localStorage`). The **Project** menu in the top bar
starts a new project, loads an example, and handles files: **Export** writes the same scenario
format the CLI reads, and **Import** accepts either that or an exported project.

The solver runs in a Web Worker, so the page stays responsive during a long search. **Stop**
terminates the worker, and whatever that run had found is discarded: a synchronous search can't
be asked to stop politely. To end early and keep results, lower the time limit instead.

## Time off and pins

Availability describes a person's *usual* week. Time off and pins are tied to **calendar dates**
and only apply when their date falls in the week being scheduled. Entries for other weeks are kept,
so vacations can be entered ahead of time.

- **Time off** runs from a start date and time to an end date and time, as one continuous block.
  "Tue 2pm → Thu 11am" is off from Tuesday afternoon straight through to Thursday morning. Those
  hours become unavailable, overriding availability; a span crossing into or out of the week
  counts only the part inside it.
- **A pin** means the person *must work at least* those hours. The solver may start earlier, end
  later, or add a second block on a split-shift day. A pinned day can't be a day off. Pins are
  painted onto the grid and saved against the dates of the week on screen; painting across a few
  hours stores them as one run.

Both are hard constraints, never scored. A pin that can't be honoured is reported before any
search runs: outside opening hours, during time off or unavailable hours, longer than any legal
shift, or more pinned hours than the weekly maximum.

The solver itself knows nothing about dates. `resolveWeek` (`src/core/calendar.ts`) turns the
dated entries into that week's availability grid plus a `pinned` grid. Pattern enumeration then
keeps only the day-patterns that cover every pinned hour, so pins shrink the search rather than
filtering its results.

---

## How it works

The admin defines **operating hours** and a **minimum headcount per hour**. Employees have a
max weekly hours cap, a target weekly hours figure, and an availability grid labelling every
hour **preferred**, **not preferred**, or **unavailable**. The solver decides who works which
hours.

### Shift shapes are generated, not filtered

For each `(employee, day)` the solver enumerates every legal **day-pattern** up front:
contiguous blocks within the operating window and the employee's availability, respecting
`minShiftLength`, `maxShiftLength`, `maxDailyHours`, `maxBlocksPerDay` and — when split shifts
are enabled — `minGapBetweenBlocks`.

Because shape rules act as *generators*, an illegal shift is never constructed, so it never
needs rejecting. The search then chooses among patterns rather than among individual hours.

### The pruning contract

Everything rests on one invariant:

> **A node's score is an upper bound on every schedule beneath it.**

That is what licenses the core move — if a node already scores below the threshold, no
completion of it can qualify, so the entire subtree is discarded.

**Penalty-only scoring** is what buys the invariant. Every schedule starts at 100 and rules
only ever subtract, so the score can only fall as the search descends. The naive alternative is
unsound: with a `+5` reward in play, a node scoring 75 against a threshold of 80 might still
finish at 105, and pruning it would throw away the best schedule in the tree.

The subtlety is **end-state rules**. "Penalise hours below target" is not knowable mid-search,
so rules do not report a penalty — they report a **lower bound on their final penalty**, which
must be:

1. non-negative,
2. **monotone** — assigning another slot never lowers it,
3. exact once the schedule is complete.

Property (2) is load-bearing. A rule whose bound can dip makes the solver silently discard
qualifying schedules — no error, no crash, just a result set quietly missing entries. It is
enforced by tests, not by review (see [Verification](#verification)).

Two further prunes need no bounds reasoning at all and do most of the early work:

- **Coverage reachability** — an hour can no longer reach its minimum headcount from the
  employees still undecided.
- **Weekly hours** — the assignment would breach a hard `maxWeeklyHours` cap.

### On "every possible combination"

For small rosters the search genuinely completes, and the result is provably every schedule at
or above the threshold. For a realistic one — 8 employees, a 75-hour week, split shifts — the
raw space runs to roughly `patterns^(employees × days)`, far beyond exhaustion. Pruning removes
the overwhelming majority; it may still not finish.

The design does not paper over this. The node/time budget is configurable (set it to `Infinity`
for a genuinely unbounded run), and **every report states whether the search was proven
exhaustive or cut short**:

```
✓ SEARCH COMPLETE — the pruned tree was explored exhaustively
  schedules        722 at or above threshold, 100 retained

⚠ SEARCH TRUNCATED — stopped on the node budget
  depth reached    56 of 56 slots
  ⚠ Better schedules may exist in the unexplored remainder.
```

Results are capped by a bounded top-K heap, because "everything above the threshold" can run to
millions of near-identical variants. Anything dropped by that cap is reported too — a capped
result set never masquerades as the complete one.

---

## Scores are absolute, so calibrate the threshold

Score is `100 − (total penalty)`, and penalties are **absolute counts**: one non-preferred hour
costs the same whether the roster is 3 people or 30. A larger week therefore accumulates far
more penalty and scores well below 100 even when the schedule is good. `small-cafe` peaks at
**80**; `medium-shop` peaks near **−101**. Neither number means anything on its own.

There is no universal "good score" — measure it:

```bash
npm run solve -- src/fixtures/medium-shop.json --calibrate
```

```
best score found   -101
suggested threshold -111
```

## Rules

All penalty-only, all weights admin-configurable. *Local* rules depend on a single
`(employee, day, pattern)` and are precomputed into a lookup table; *global* rules need to see
across slots and supply a monotone bound.

| Rule | Kind | Bound quality |
|---|---|---|
| `nonPreferredHour` | local | tight |
| `splitShift` | local | tight |
| `shortShift` | local | tight |
| `overCoverage` | global | tight |
| `overTargetHours` | global | tight |
| `clopen` — close then open next morning | global | exact once both days decided |
| `consecutiveDays` | global | tightens as runs close |
| `underTargetHours` | global | weak early, tightens as capacity drains |
| `evenDistribution` — busiest vs. quietest | global | weak early, exact at completion |

Tight-bound rules drive most of the pruning; weak-bound rules are correct but contribute little
until deep in the tree.

**Hard constraints are never rules** and are never scored: coverage minimums, `maxWeeklyHours`,
availability and time off, pins, shift-length bounds, gap bounds, `maxDailyHours`.

---

## CLI

```
npm run solve -- <scenario.json> [options]

  --threshold <n>    Keep schedules scoring at or above n
  --max-results <n>  Schedules to retain (default 100)
  --max-nodes <n>    Node budget; "none" for unlimited (default 5000000)
  --max-ms <n>       Time budget in ms; "none" for unlimited (default 30000)
  --tighten          Once full, raise the pruning floor to the best kept score. Much faster,
                     but proves only the top-K rather than every schedule above the threshold.
  --show <n>         Schedules to print (default 3)
  --calibrate        Report the best achievable score and suggest a threshold
```

Scenario files use hour ranges rather than 168-entry grids. Anything not listed is unavailable:

```json
{
  "threshold": 70,
  "config": {
    "operatingHours": { "Mon": [9, 15], "Tue": [9, 15] },
    "minCoverage": 1,
    "minShiftLength": 3,
    "maxShiftLength": 4,
    "allowSplitShifts": false
  },
  "employees": [
    {
      "id": "ana", "name": "Ana",
      "maxWeeklyHours": 12, "targetWeeklyHours": 8,
      "preferred": { "Mon": [[9, 15]], "Tue": [[9, 13]] },
      "notPreferred": { "Wed": [[9, 15]] }
    }
  ]
}
```

`minCoverage` also accepts per-day ranges: `{ "Mon": [[8, 11, 1], [11, 14, 3]] }`.

Dated entries need a top-level `weekStart`, which must be a Monday. Time off is either one
`date` (optionally just `hours` of it) or a stretch `from` one date `to` another. `fromHour`
defaults to the start of `from`; without `toHour` it runs to the end of `to`:

```json
{
  "weekStart": "2026-09-21",
  "employees": [
    {
      "id": "ana", "name": "Ana", "maxWeeklyHours": 12, "targetWeeklyHours": 8,
      "preferred": { "Mon": [[9, 15]], "Tue": [[9, 13]] },
      "timeOff": [
        { "date": "2026-09-22" },
        { "date": "2026-10-05", "hours": [9, 12] },
        { "from": "2026-10-13", "to": "2026-10-15", "fromHour": 14, "toHour": 11 }
      ],
      "pins": [{ "date": "2026-09-21", "hours": [9, 11] }]
    }
  ]
}
```

---

## Verification

`npm test` — 182 tests. Three carry the correctness argument:

**`tests/solver.exhaustive.test.ts` — brute force vs. branch-and-bound.** On a fixture sized so
full enumeration is feasible, the answer is computed twice: once by naive exhaustion with no
pruning at all, once by the real solver. The two sets must be *identical*, across six rule
configurations and a range of thresholds. If any bound is ever too aggressive, this names the
schedules that were wrongly discarded. It repeats the check with pins and time off applied. Because
those work by narrowing the pattern lists, it also enumerates the *unconstrained* roster, keeps only
the schedules that visibly honour the dated entries, and requires the same set.

**`tests/rules.monotonicity.test.ts` — property tests per rule.** Random root-to-leaf walks
assert non-negativity, monotonicity, and exactness at completion for every rule individually.
It also plants deliberately broken rules and requires that they *are* caught — including one
that proves a non-monotone bound really does make the solver lose valid schedules. A property
test that never fails is worthless, so the harness is tested against known-bad input.

**`tests/bounds.test.ts` — soundness stated directly.** Rather than inferring correctness from
matching result sets, it walks the solver down the exact path of each known-good schedule and
requires that no prune condition is ever true along the way.

Plus: pattern enumeration checked against an independent declarative predicate over all 2^12
subsets of the operating window; `applyPattern`/`undoPattern` verified as a perfect inverse;
the slack invariant checked against a from-scratch recount at every depth; every emitted
schedule re-validated against the hard constraints from scratch.

---

## Layout

```
src/core/types.ts              model and constants
src/core/config.ts             defaults, validation of impossible rosters (including pins)
src/core/calendar.ts           dates; applies a week's time off and pins to the roster
src/core/patterns.ts           legal day-pattern enumeration, problem context
src/core/state.ts              incremental search state (apply / undo)
src/core/rules/                Rule interface, built-ins, compilation, serializable catalog
src/core/search/ordering.ts    slot order + coverage-aware candidate ranking
src/core/search/solver.ts      branch-and-bound, budgets, calibration
src/core/report.ts             top-K heap, search report, formatting
src/core/io.ts                 scenario file parsing and serialization
src/cli.ts                     dev harness
src/app/project.ts             editor model: plain-data project, edits, persistence
src/app/useSolver.ts           owns the solver worker (progress, cancel, results)
src/app/components/            Setup, Employees, Scoring, Solve screens; week grid and picker; time off
src/worker/                    worker entry, message protocol, request handler
```

## Not built yet

- **Roles and skills.** Coverage is a plain headcount per hour; anyone available counts.
- **Constraint propagation** in the solver, which would let large rosters finish instead of
  hitting the time limit.
- **Schedule export** (CSV, calendar, printable week). Export currently saves the project, not a
  chosen schedule.
- **Keyboard painting** of the week grids; availability and coverage are mouse and touch only.

The `Rule` interface is shaped so bounded reward-style rules can be added later without
reworking the engine.
