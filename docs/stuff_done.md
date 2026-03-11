# Tokenleak — Completed Work

All 18 planned PRs have been implemented and merged. 257 tests pass across 4 packages.

## PR #1: `chore/monorepo-bootstrap`
- Initialized Bun + Turborepo monorepo
- Created workspace packages: core, registry, renderers, cli
- Shared TypeScript config in `tooling/typescript-config`
- Added ESLint (flat config), Prettier

## PR #2: `feat/core-types`
- Defined all shared data types in `@tokenleak/core`
- `DailyUsage`, `ModelBreakdown`, `ProviderData`, `AggregatedStats`, `TokenleakOutput`
- `RenderOptions`, `DateRange`, `CompareOutput`, `CompareDeltas`
- Constants: `DEFAULT_DAYS`, `DEFAULT_CONCURRENCY`, `MAX_JSONL_RECORD_BYTES`, `SCHEMA_VERSION`

## PR #3: `feat/provider-interface`
- `IProvider` interface with `name`, `displayName`, `colors`, `isAvailable()`, `load()`
- `ProviderRegistry` for registering and discovering providers

## PR #4: `feat/model-normalizer-and-pricing`
- Model name normalizer: strips trailing `-YYYYMMDD` date suffixes
- Token pricing table for 14 models (Claude 3/3.5/4, GPT-4o, o-series)
- `estimateCost()` function for per-token cost calculation

## PR #5: `feat/jsonl-record-splitter`
- Bounded JSONL async generator (memory-safe)
- Respects `TOKENLEAK_MAX_JSONL_RECORD_BYTES` environment variable

## PR #6: `feat/json-renderer`
- `IRenderer` interface: `render(output, opts) => Buffer | string`
- `JsonRenderer` producing structured JSON output

## PR #7: `feat/aggregation-engine`
- Streaks, rolling 30-day windows, peak day detection
- Day-of-week breakdown, cache hit rate, averages, top N models
- `mergeProviderData` for combining multiple providers
- `aggregate()` orchestrator function

## PR #8: `feat/claude-code-parser`
- Claude Code JSONL provider reading from `~/.claude/projects`
- Streaming parser with model normalisation and cost calculation

## PR #9: `feat/opencode-parser`
- Open Code provider: SQLite (`sessions.db`) + legacy JSON fallback

## PR #11: `feat/codex-parser`
- Codex session provider reading JSONL from `~/.codex/sessions/YYYY/MM/DD/`

## PR #12: `feat/terminal-renderer`
- ANSI heatmap with Unicode block characters
- Stats dashboard with box-drawing characters
- One-liner mode for narrow terminals
- Respects `--no-color` and terminal width

## PR #13: `feat/svg-renderer`
- SVG heatmap grid, stats panel, insights panel
- Day-of-week chart, model breakdown chart
- Light and dark theme support

## PR #14: `feat/cli-entrypoint`
- CLI with `citty`: `--format`, `--theme`, `--since`, `--until`, `--days`, `--output`, `--width`, `--no-color`, `--no-insights`, `--provider`
- Config file support (`~/.tokenleakrc`)
- Environment variable overrides (`TOKENLEAK_*`)

## PR #15: `fix/install-citty`
- Fixed missing `citty` dependency in cli package

## PR #16: `feat/png-renderer`
- SVG-to-PNG conversion via `sharp`

## PR #17: `chore/ci-docs-release`
- GitHub Actions CI workflow (lint, build, test)
- README.md with install, usage, flags, providers
- CONTRIBUTING.md with dev setup and PR workflow

## PR #18: `feat/wrapped-and-badge`
- Wrapped card SVG (1200x630) for year-in-review
- Badge SVG with streak count for READMEs
- `prefers-color-scheme` media query support

## PR #20: `feat/sharing-features`
- `--clipboard` flag: copy output via pbcopy/xclip/clip
- `--open` flag: open output file in default application
- `--upload gist` flag: upload to GitHub Gist via `gh` CLI
- Platform detection for macOS, Linux, Windows

## PR #22: `feat/compare-mode`
- `--compare` flag for diffing two date ranges
- `computeDeltas()`, `buildCompareOutput()`, `parseCompareRange()`
- `computePreviousPeriod()` for automatic period splitting
- Delta values (positive, negative, zero) in JSON output
