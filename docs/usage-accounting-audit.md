# Usage accounting: regression audit

This change corrects recorded token accounting. Tokscale is a useful independent
comparison, but its estimates and omissions are not a billing ledger. We preserve
usage supported by source records even when that leaves a documented difference.

## Scope

Validation used an immutable local snapshot, inclusive UTC dates **2020-01-01
through 2026-09-06**, and Tokscale **4.15.1**. SQLite databases were copied with the
SQLite backup API. Transcript and CSV copies contained no credentials. Raw local
artifacts are not part of this repository or PR.

Tokscale's settings must pin `scanner.bucketTimezone` to `UTC` in the isolated
snapshot's `.config/tokscale/settings.json`. Setting `TZ=UTC` alone does not override
an existing pinned timezone. Tokenleak uses UTC usage dates. Tokscale's separate
reasoning bucket must be added to its input, output, cacheRead, and cacheWrite
buckets; Tokenleak's output bucket already includes reasoning.

## Verified totals

| Source | Corrected Tokenleak | Tokscale | Explanation |
|---|---:|---:|---|
| Claude Code | 1,272,947,936 | 1,272,947,936 | Exact match; independent global deduplication of raw messages agrees |
| Codex | 5,466,106,024 | 5,464,072,211 | 2,033,813 additional tokens independently supported by response records |
| OpenCode | 3,912,433 | 3,912,433 | Exact match; SQLite plus JSON and reasoning |
| OpenClaw | 6,723,322 | 6,723,322 | Exact match |
| Hermes | 2,066,668 | 2,066,668 | Exact match |
| Cursor | 233,729,547 | 233,729,547 | Exact match using the same CSV; independent row totals also agree |

The initial audit used an older Tokenleak revision (`d0ea3d6`). This PR is based on
`main` after v2.2.0 (`8c12aac`) and retains its newer response-ledger reconciliation,
service-tier pricing, archive discovery, ingestion validation, and file caching.
Some initial audit findings were already fixed on that newer base.

### Claude Code

Deduplication is global across transcript files, keyed by message ID and request
ID. Streaming snapshots merge using the maximum of each token field, so an older
snapshot cannot erase usage. Distinct requests and records without stable IDs are
preserved. The merged request belongs to its earliest timestamp, before date
filtering; copying a transcript across midnight cannot count it on another day.
This intentionally changes the old latest-snapshot-day behavior.

The original per-file-only logic counted **94,350,948 duplicate tokens** in the
audited logs. Source-level global deduplication reconciled the entire difference.

### Codex

Notification counters retain request increments, suppress repeated snapshots, and
keep their baseline across model changes. Reset epochs allow genuinely new usage
with counters seen in a previous epoch. A response ledger and its notification
mirror count once; a response without a notification still counts. Empty status
updates retain the cumulative baseline without consuming a request identity.

Forked transcripts can embed parent history with rewritten timestamps. Parent
replay is excluded until a child-local turn is established. UUIDv7 time prefixes
and task-start evidence identify the boundary; inherited cumulative snapshots
remain suppressed after that boundary. Response records explicitly belonging to
another thread are not charged to the child. Explicitly child-owned response
records are retained even when a partial log lacks child turn context; this does
not open the replay gate for inherited notifications. Active/archive overlap retains
response identity and counter identity scoped to its turn (or timestamp when
turn metadata is absent). Counter collisions never override distinct response IDs. Unrelated files without upstream
session IDs retain their distinct paths.

Model attribution reads explicit model metadata, including `model_info.slug` and
request usage metadata. Instruction prose is not a model identifier. Parser cache
namespaces are advanced so old parsed records cannot survive these changes.

**Why the remaining Tokscale difference is correct:**

- One real request has 180,171 input tokens and 141 output tokens: **180,312**.
  It starts a new turn after the notification counter resets. A unique response-ID
  ledger record confirms the usage. Tokscale's stale-regression heuristic discards
  the notification, so matching that total would delete a real request.
- Eight unique response records have no matching token-count notification. Their
  totals are **239,354; 246,976; 226,642; 222,310; 229,259; 223,099; 238,116; and
  227,745**, summing to **1,853,501**. They are retained by Tokenleak's existing
  response-ledger support and omitted by Tokscale's notification-based report.
- Together: **180,312 + 1,853,501 = 2,033,813**. This fully reconciles the difference
  on the frozen snapshot.

An independent scan verified **1,198 unique response IDs**, totaling
**147,338,996 tokens**, each present exactly once with the exact raw input-plus-output
count. No mismatches were found. This check is independent of notification-counter
heuristics.

### OpenCode

Read both modern SQLite `message` rows and legacy JSON message storage. Prefer the
payload's stable message ID, with the SQLite row ID as a fallback, and merge
migration/fork copies before date filtering. Reasoning is a separate source bucket
and is included in output exactly once. Malformed database rows are reported and
valid neighboring rows remain readable.

The original difference is exactly **76,436 SQLite-only tokens + 5,958 reasoning
tokens = 82,394 tokens**.

### Cursor

Cursor CSV columns `Input (w/ Cache Write)` and `Input (w/o Cache Write)` are
independent buckets. The old parser subtracted the second from the first, losing
**1,260,878 tokens**. The corrected sum is **233,729,547**, matching the source CSV.
All **1,405 rows** have internally consistent `Total Tokens`; zero-token rows do
not emit usage events. Synthetic test CSVs now use the actual disjoint-column
contract rather than the previous inclusive-input assumption.

## Differences that must not be disguised as exact usage

- The local Kiro IDE data has no exact token ledger. Tokscale estimates tokens
  from text length (roughly characters divided by four). Its **174,314** estimated
  tokens are not an exact target for Tokenleak's recorded-token totals. Existing
  Kiro CLI support remains unchanged.
- Zed is detected by Tokenleak but has zero recorded usage in this period.
- Explicit zero provider-reported costs remain zero. Unknown model prices remain
  unpriced, with the existing completeness indicators. Service-tier metadata is
  retained. We do not invent prices or replace recorded zero costs to force dollar
  parity. Tokscale's LiteLLM fetch also failed certificate validation during this
  audit. These exports are not verified provider invoices.
- The evidence establishes correctness for the inspected records and tested
  formats, not an absolute guarantee for every future log schema or corrupted
  export. Records without stable identities cannot safely be collapsed merely
  because their token counts happen to be equal.

## Validation and reproduction

Regression coverage includes global and cross-file deduplication, decreasing
streaming snapshots, distinct equal-size requests, archive overlap, resumed
counters, resets, UTC date boundaries, response-only usage, forked history with
and without embedded parent metadata, JSON/SQLite migration, and Cursor bucket
semantics. Seven additional regression cases cover review findings: distinct response IDs
with colliding counters, notification-only resets across turns, missing turn IDs,
child-owned ledgers with and without copied parent metadata, and empty status
baselines. These fixes ship in v2.2.1. Cold and warm snapshot reads must be byte-identical; aggregate, daily,
model, and event token sums must agree.

Run repository checks:

```sh
bun run build
bun run check
bun run test
```

Run both tools with explicitly aligned data and dates. Use an isolated copy of
local data and UTC-pinned Tokscale settings; do not submit private usage exports:

```sh
bun packages/cli/src/cli.ts --format json --since 2020-01-01 --until 2026-09-06 --provider claude-code,codex,open-code,openclaw,hermes --output tokenleak.json
npx --yes tokscale@4.15.1 --home /path/to/snapshot --json --client claude,codex,opencode,openclaw,hermes --since 2020-01-01 --until 2026-09-06 --no-spinner > tokscale.json
```

For a snapshot-only Tokenleak run, inject each provider's snapshot directory through
its constructor, including the explicit Codex archive directory and SQLite file
paths. Compare normalized token buckets, not raw event counts or estimated costs.
