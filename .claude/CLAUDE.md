# Tokenleak — Claude Opus Agentic Rules

## Workflow: Every Feature = A PR

For every task, feature, fix, or phase you complete, you must:

1. Create a new branch off `main` using the format:
   `feat/<short-description>`, `fix/<short-description>`, or `chore/<short-description>`
2. Make your changes with clean, atomic commits
3. Write or update tests before opening the PR
4. Open a PR against `main` with a structured description (see format below)
5. Review the PR yourself thoroughly before merging (see review checklist below)
6. Merge the PR only after the review checklist passes
7. Delete the branch after merging

Never commit directly to `main`.

---

## Commit Style

Use conventional commits:

- `feat: add streak calculator`
- `fix: handle empty JSONL files gracefully`
- `test: add edge cases for rolling window aggregator`
- `chore: set up turborepo pipeline`

Keep commits small and focused. One logical change per commit.

---

## PR Description Format

Every PR you open must include:

```
## What
<1-3 sentences describing what this PR does>

## Why
<why this change is needed, what problem it solves>

## How
<brief explanation of the approach taken>

## Test Coverage
<list every test file added or modified, and what scenarios are covered>

## Checklist
- [ ] All new code has unit tests
- [ ] Edge cases are covered (empty input, single item, boundary values)
- [ ] Error paths are tested
- [ ] Types are strict (no `any`)
- [ ] No dead code or console.log left in
- [ ] README or JSDoc updated if public API changed
```

---

## Self-Review Checklist (complete before merging)

Go through every item. Do not merge if any item fails — fix it first.

**Correctness**

- [ ] Does the logic handle empty data, null values, and boundary dates?
- [ ] Are all edge cases from the TODO covered?
- [ ] Do all tests pass (`bun run test`)?
- [ ] Does the build succeed (`bun run build`)?

**Test Quality**

- [ ] Every new function has at least one happy path test
- [ ] Every new function has at least one failure/edge case test
- [ ] Streaks, rolling windows, and date logic have month-boundary tests
- [ ] Parser tests cover malformed input and oversized records
- [ ] Minimum 80% coverage on new files

**Code Quality**

- [ ] No `any` types — use `unknown` and narrow properly
- [ ] No unhandled promise rejections
- [ ] All errors produce clear, actionable messages with exit code 1
- [ ] No magic numbers — use named constants
- [ ] Functions are small and single-purpose

**Integration**

- [ ] The CLI still works end-to-end after this change (`node packages/cli/dist/cli.js`)
- [ ] No regressions in existing tests
- [ ] Package exports are correct in `package.json`

---

## Test Requirements Per Phase

### Parsers (Phase 1)

- Happy path: valid JSONL/SQLite with 30+ days of data
- Empty file
- Missing directory (isAvailable returns false, does not throw)
- Oversized record: fails with correct error message naming file + line
- Model name normalisation: strips `-20251101` suffix correctly
- Cost calculation: known model + known token count = expected dollar amount

### Aggregation Engine (Phase 1)

- Streak: no usage = 0, single day = 1, gap resets streak
- Streak spanning month/year boundary
- Rolling 30-day window with data outside the window (must be excluded)
- Peak day with ties (pick the most recent)
- Cache hit rate: 0 cache tokens = 0%, all cache = 100%
- Day-of-week: data on only one day of the week
- Empty provider data returns zeroed AggregatedStats, does not throw

### Renderers (Phase 3 & 4)

- PNG renderer: output is a valid PNG buffer (check magic bytes `\x89PNG`)
- SVG renderer: output contains `<svg` and all provider names
- Terminal renderer: output at width 80 contains no lines exceeding 80 chars
- Terminal renderer: --no-color produces no ANSI escape codes
- Wrapped card: output dimensions are 1200×630

### CLI (Phase 6)

- `--since` and `--until` correctly filter daily data
- `--compare` produces delta values (positive and negative)
- Unknown flag exits with code 1 and prints usage
- No providers with data exits with code 1
- Config file defaults are overridden by CLI flags

---

## Branch Protection Rules (enforce via GitHub)

Set these up before starting:

- Require PR before merging to `main`
- Require all status checks to pass (lint, test, build)
- Do not allow bypassing the above rules even for admins

---

## General Principles

- Prefer explicit over implicit — if something could be ambiguous, name it clearly
- Small PRs are better than large ones — if a phase has multiple logical units, split them into multiple PRs
- If you discover a bug while working on a feature, fix it in a separate PR
- Never skip tests to ship faster — untested code is not done
- If a test is hard to write, the function is too complex — refactor first
