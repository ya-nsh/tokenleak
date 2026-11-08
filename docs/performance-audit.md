# Local performance audit

Measured on macOS with Bun 1.3.10, starting from commit `d0ea3d6`.
The local dataset contained approximately 58,400 usage events: 913 MB of
Codex session logs and 325 MB of Claude logs, plus Cursor, OpenClaw,
Hermes and OpenCode data. Active sessions continued growing during the audit.

## Results
|

These are observed local timings, not latency guarantees. The CLI comparison
was taken after report memoization was already implemented, so the improvement
from the original source is conservatively represented. JSON output was sent to
`/dev/null`; timing includes process startup, provider selection, ingestion,
report generation, serialization and output, but excludes terminal rendering.
Provider timings overlap because loading is concurrent and must not be added.
The phase benchmark excludes pricing initialization and Cursor network sync.

## Measured bottlenecks and changes

1. **Repeated transcript parsing.** Every refresh reread and parsed the complete
   Codex and Claude histories, even when files were unchanged. The initial CPU
   profile was dominated by JSON parsing and readline splitting. Providers now
   persist extracted, unpriced usage records per source file in a provider/root
   snapshot. Date filtering, Claude message deduplication, pricing and aggregation
   still run for every request. The snapshot includes the existing bounded prompt
   excerpts needed by Replay, rather than full transcript objects.

2. **Repeated filesystem discovery.** Session and project rollups called
   `inferRepoRoot` for every event, repeatedly walking the same directories and
   checking `.git`. A resolver now memoizes project lookups within each calculation.
   Its lifetime ends with the calculation, so a subsequent report sees newly
   created repositories. On one saved 58,414-event input, original versus updated
   timings were 102/32 ms for session rollups, 188/61 ms for project rollups, and
   108/45 ms for attribution. All three output structures were deeply equal.

3. **Automatic Cursor network retries.** An isolated failed Cursor sync took
   2.26 seconds. Previously, every unfiltered CLI invocation retried it. Automatic
   runs now reuse sync results for 60 seconds when local active-account usage is
   available. Failed results retain their warning. Explicit Cursor selection and
   TUI refresh continue to request fresh data immediately. Credential or cache
   changes invalidate reuse. An isolated pricing initialization also took 337 ms;
   its existing network/fallback behavior is unchanged.

## Cache correctness and controls

Usage cache identity includes provider parser version, source root and JSONL
record-size policy. Each source entry checks device, inode, size, nanosecond
mtime and ctime. Appended, truncated or replaced files are reparsed from the start
so cumulative token counters, model context and prompts are reconstructed.
Files that change during parsing are not cached. Deleted files are removed from
the next snapshot. Parse/oversize warnings are retained; failed reads are retried.
Missing or invalid JSON snapshots fall back to parsing. Writes use unique temporary
files, atomic rename and private permissions; persistence failures are nonfatal.

- Default usage cache: `~/.cache/tokenleak/usage/usage.sqlite` (see "SQLite usage store" below).
- `TOKENLEAK_USAGE_CACHE_DIR` chooses another cache directory.
- `TOKENLEAK_USAGE_CACHE=0` bypasses usage caching for diagnosis.
- `TOKENLEAK_CURSOR_SYNC_INTERVAL_MS=0` forces automatic Cursor sync on every run.
  Default is 60000 ms; explicit Cursor selection bypasses reuse regardless.
- Cursor automatic-sync metadata is stored next to the existing Cursor CSV cache.
  It contains a credential/cache fingerprint and the prior error, never tokens.
- Provider parser changes must bump the namespace version in the provider.

The local usage snapshots occupied about 146 MB for one pair of provider roots.
This trades disk space for latency; memory use was not established as improved.
Snapshot reads and writes still serialize all extracted history, and an active
file is reparsed in full. Other providers do not use the new usage cache.
A cold installation and the first automatic sync after expiry remain slower.

## Reproduction and validation

From the audit worktree, run `bun scripts/perf-audit.ts 3` to obtain phase timings,
provider event counts, output hashes and process RSS. Run it with
`TOKENLEAK_USAGE_CACHE=0` for an uncached comparison. Use a dedicated
`TOKENLEAK_USAGE_CACHE_DIR` to measure first population. The script prints hashes
instead of prompts or project paths. Active files can change between runs, so
hash differences must be checked against event counts and source changes.

CPU profiles can be collected with Bun's `--cpu-prof` and `--cpu-prof-dir` flags.
The local `.perf/` directory is ignored because profiles and saved snapshots can
contain private source paths and usage. Do not publish those artifacts.

Validation includes cold/warm/uncached provider equality, changing date ranges,
Claude duplicate IDs across days, repricing without reparsing, appends, truncation,
replacement with restored mtime, deletion, changes during parsing, malformed
cache JSON, persistence failures, retained warnings, parser-policy invalidation,
Cursor success/failure reuse, expiry, credentials, cache deletion and forced sync.
The actual TUI was launched in a PTY, refreshed and exited successfully.
Two existing Focus CLI tests were given explicit fixture dates so they no longer
fail as the current date moves beyond their default rolling window.

Final checks: **1,012 tests passed, 1 skipped, 0 failed**; all ten workspace
build/type-check tasks passed. Targeted lint passed for the new and changed
performance modules. Full-repository lint remains blocked by 25 pre-existing
unused-variable/import errors elsewhere, including old lines in CLI files.

## Review fixes and integration

Merged the current main branch, preserving its archived Codex sessions, delayed
usage reconciliation, Fast tier identity, prompt IDs and latest-message Claude
deduplication. Provider cache namespaces were bumped to v2 so earlier snapshots
cannot bypass the updated parsers.

Cached records and warning payloads are now validated before reuse. Invalid
payloads trigger source reparsing and snapshot replacement. Automatic Cursor
sync captures its credential fingerprint before the request and only memoizes
the result if the credentials remain unchanged at completion.

Post-integration validation: **1,179 tests passed, 1 skipped, 0 failed**, and all
ten workspace build/type-check tasks passed. Both original review reproductions
now retain correct behavior, with regression coverage for repeated invalid-cache
loads and credential replacement during a pending request.

## SQLite usage store

The per-root JSON snapshots were replaced by one SQLite database,
`usage.sqlite`, in the same directory. Each source file is one row holding its
stamp, its extracted records and warnings, and optional resume data. An
unchanged file costs one row lookup, and a save writes only changed rows. A
growing session therefore no longer rewrites the whole cache, which was about
70 MB for Claude Code on the audit machine. JSON snapshots from earlier
versions are deleted on a later save, once they have gone a week without a
write. Other parser versions' rows in the store, and `tui-data-v*.json`
snapshots from other TUI versions, follow the same one-week rule. Deleting them
immediately made two installed versions (a global release beside a local
build) wipe each other's caches. Whichever ran next then reparsed every log,
which took 9.3 s to first data instead of 0.3 s on the audit machine.

Claude Code transcripts are also read incrementally. A parse records the byte
offset after its last newline-terminated line, the parser state at that point
(the last user prompt and its sequence number), and SHA-256 hashes of the first
and last 4 KiB of the consumed prefix. On the next read, a file with the same
device and inode, at least that many bytes, and matching hashes is parsed only
from that offset. A shrunk, replaced or rewritten file is reparsed in full, as
before. Records from an unterminated final line are returned, but they are
counted separately and read again on resume.

`entries` is an ordinary rowid table with a unique `(cache_key, file)` key.
Payloads average over 100 KiB, and a `WITHOUT ROWID` layout made each lookup
5 to 10 times slower. The database uses WAL mode and a 2 s busy timeout so
concurrent tokenleak processes can share it. A corrupt database is deleted and
rebuilt once. An unwritable location disables caching.

Measured on the Claude Code history alone (51k events, 545 transcripts), six
loads 2 s apart while one session kept writing:

| | cold | warm while a session is live |
|---|---|---|
| JSON snapshots | 6.2 s | 513–609 ms (255 ms once idle) |
| SQLite store | 7.3 s | 274–356 ms |

Resumed, warm and uncached parses were deep-equal on 25 real transcripts
truncated mid-line, then completed by appending.

### Columnar payloads

Each row's payload is now stored column-wise (`format: 2`). Every key is written
once per file. A value that every record of the file shares, such as the
session and project IDs of a Claude Code transcript, is written once. The
remaining values become one array per record, with `null` for a missing key.
Records that cannot round-trip exactly this way (a stored `null`, a non-finite
number, a non-object, a `__proto__` key) keep the older row layout, which is
still read.

The layout is part of the cache key, so an older install beside this one keeps
its own rows. On first read, a row stored under the older key is used if its
stamp still matches (or resumed if the file only grew) and is rewritten under
the new key, so upgrading does not reparse every log. The older key's rows
follow the one-week rule above.

Measured on 632 Claude Code transcripts (155k records) and 131 Codex sessions:

| | Claude Code payloads | Codex payloads | `statusline` peak RSS | `statusline` wall (median of 12, interleaved) |
|---|---|---|---|---|
| Row layout | 80.3 MB | 2.9 MB | 344 MB | 0.51 s |
| Columnar | 29.7 MB | 1.1 MB | 292 MB | 0.49 s |

With the database already in the page cache, looking up and decoding every
Claude Code row costs about the same in both layouts (120–150 ms). On a first
read, the columnar store read and decoded in 160 ms instead of 355 ms, because
there is a third as much data to read from disk.

## Status line snapshot

`tokenleak statusline` used to load 60 days of usage from every provider on each
call, about 0.5 s with a warm cache and over 3 s on a machine under memory
pressure. Status bars call it on every prompt.

It now serves a snapshot from `~/.cache/tokenleak/statusline/<key>.json`, where
the key covers the provider selection and every environment variable that
moves log locations or the time zone:

- A snapshot under 5 s old is printed as is.
- An older one is printed at once, and a detached `tokenleak statusline` with
  `TOKENLEAK_STATUSLINE_REFRESH_TOKEN` set recomputes it. An `O_EXCL` lock file
  allows one refresh at a time. A lock older than 2 minutes is taken over, so a
  refresh that crashes or fails is retried after that delay.
- A snapshot from another local day, from the future, or older than 10
  minutes is not served. The line is computed in the foreground and stored.

Snapshots are written to a temp file and renamed, with mode `0600`.
`TOKENLEAK_STATUSLINE_CACHE=0` turns the snapshot off.

Measured on 632 Claude Code transcripts and 131 Codex sessions, 12 interleaved
runs each:

| | median | min | max |
|---|---|---|---|
| Computed on every call | 0.553 s | 0.512 s | 1.241 s |
| Served from the snapshot | 0.071 s | 0.069 s | 0.103 s |
