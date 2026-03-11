# Tokenleak — Completed Work

## PR 1: `chore/monorepo-bootstrap`
- Initialized Bun + Turborepo monorepo
- Created workspace packages: core, registry, renderers, cli
- Shared TypeScript config in `tooling/typescript-config`
- Added ESLint (flat config), Prettier
- Trivial test in `@tokenleak/core`

## PR 2: `feat/core-types`
- Defined all shared data types in `@tokenleak/core`
- `DailyUsage`, `ModelBreakdown`, `ProviderData`, `AggregatedStats`, `TokenleakOutput`
- `RenderOptions`, `DateRange`, and constants (`VERSION`, `SCHEMA_VERSION`, `DEFAULT_DAYS`)

## PR 3: `feat/model-normalizer-and-pricing`
- Model name normalizer: strips trailing `-YYYYMMDD` date suffixes
- Token pricing table for Claude 3/3.5/4, GPT-4o, o1, o3 model families
- Cost estimator mapping model name to per-token input/output/cache pricing

## PR 4: `feat/jsonl-record-splitter`
- Bounded JSONL streaming record splitter (memory-safe)
- Respects `TOKENLEAK_MAX_JSONL_RECORD_BYTES` environment variable
- Shared utility used by Claude Code and Codex providers

## PR 5: `feat/provider-interface`
- Defined `IProvider` interface with `name`, `displayName`, `colors`, `isAvailable()`, `load()`
- Created `ProviderRegistry` for registering and discovering providers
- Exported from `@tokenleak/registry`

## PR 6: `feat/json-renderer`
- Added `IRenderer` interface: `render(output, opts) => Buffer | string`
- Implemented `JsonRenderer` producing structured JSON output
- Exported from `@tokenleak/renderers`

## PR 7: `feat/aggregation-engine`
- Aggregation engine with streaks, rolling 30-day windows, peak day detection
- Day-of-week breakdown, cache hit rate, average tokens/day
- Top N models by total tokens
- `mergeProviderData` for combining multiple providers

## PR 8: `feat/claude-code-parser`
- Claude Code JSONL provider reading from `$CLAUDE_CONFIG_DIR/projects`
- Streaming parser with model normalisation and cost calculation

## PR 9: `feat/opencode-parser`
- Open Code provider reading SQLite (`opencode.db`) and legacy JSON files
- Model normalisation and cost estimation

## PR 10: `feat/codex-parser` (merged via #11)
- Codex session provider reading JSONL from `$CODEX_HOME/sessions`
- Streaming parser with model normalisation and cost calculation

## PR 11: `feat/cli-entrypoint` (merged via #14)
- Wired CLI entrypoint with `citty` argument parser
- Config file support (`~/.tokenleakrc`)
- Environment variable overrides
- Provider discovery, date range filtering, format inference

## PR 12: `feat/terminal-renderer`
- Terminal renderer with ANSI heatmap using Unicode block characters
- Stats dashboard with box-drawing characters
- Respects `--no-color` and terminal width

## PR 13: `feat/svg-renderer`
- SVG renderer with heatmap grid, stats panel, and insights panel
- Light and dark theme support
- Tooltip data via `<title>` tags

## PR 14: `feat/cli-entrypoint` (final merge)
- Complete CLI wiring with all flags functional
- Error handling with clear messages and exit code 1

## PR 15: `fix/install-citty`
- Fixed missing `citty` dependency in cli package

## PR 16: Compare mode
- `--compare` flag for diffing two date ranges side-by-side
- Delta values (positive and negative) in output

## PR 17: Sharing features
- Wrapped card mode (`--wrapped`) for year-in-review summary (1200x630)
- Badge mode (`--badge`) for compact SVG README badges
- PNG renderer via `@napi-rs/canvas`

## PR 18: `chore/ci-docs-release`
- GitHub Actions CI workflow (lint, build, test on push and PRs)
- Comprehensive README with install, usage, flags, providers, config
- CONTRIBUTING.md with dev setup, PR workflow, code style, testing guide
- Updated docs/stuff_done.md with all completed PRs
