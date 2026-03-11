# Tokenleak — Build Plan & TODO

> A CLI tool that surfaces your AI coding token usage as beautiful heatmaps, terminal dashboards, and shareable cards. Supports Claude Code, Codex, and Open Code.

---

## Project Structure

```
tokenleak/
  packages/
    cli/           ← main CLI entrypoint
    core/          ← data ingestion, parsing, aggregation
    renderers/     ← PNG, SVG, terminal, JSON output engines
    registry/      ← provider definitions & normalisation
  tooling/
    typescript-config/
  README.md
  TODO.md
```

---

## Phase 1 — Foundation & Data Layer

> Goal: Solid, extensible ingestion pipeline. Everything else depends on this.

### 1.1 Project Bootstrap

- Init monorepo with Bun + Turborepo
- Set up shared TypeScript config (`tooling/typescript-config`)
- Configure Prettier + ESLint
- Set up `bun run build`, `bun run dev`, `bun run check` scripts at root

### 1.2 Core Data Types (`packages/core`)

- Define `DailyUsage` type: `{ date, input, output, cache, total, cost }`
- Define `ModelBreakdown` type: `{ model, tokens: { input, output, cache, total }, cost }`
- Define `ProviderData` type: `{ provider, daily: DailyUsage[], insights }`
- Define `AggregatedStats` type: includes streaks, averages, peaks, cost totals
- Define `TokenleakOutput` type: top-level export shape for JSON mode

### 1.3 Provider Registry (`packages/registry`)

- Port Claude Code JSONL parser from slopmeter
- Port Codex JSONL parser from slopmeter
- Port Open Code SQLite + JSON parser from slopmeter
- Abstract shared `IProvider` interface with `load()`, `isAvailable()`, `name`, `colors`
- Implement bounded JSONL record splitter (shared, memory-safe)
- Model name normaliser (strip trailing date suffixes like `-20251101`)
- Cost estimator: map model name → per-token pricing table (input/output/cache)
- Pricing table for known models (Claude 3/3.5/4 families, GPT-4o, o1, o3)

### 1.4 Aggregation Engine (`packages/core`)

- Daily rollup aggregator
- Rolling 30-day window calculator
- Streak calculator (current + longest)
- Peak day / peak week detector
- Day-of-week breakdown (Mon–Sun averages)
- Hour-of-day breakdown (requires timestamp data where available)
- Cache hit rate calculator: `cache / total`
- Average tokens/day and tokens/week
- Conversation count aggregator (where loggable)

---

## Phase 2 — CLI Entrypoint & Flags

> Goal: Feature-complete, well-documented CLI surface.

### 2.1 CLI Setup (`packages/cli`)

- Wire up argument parser (use `citty` or `yargs`)
- `--output` / `-o`: output file path (default: `./tokenleak.png`)
- `--format` / `-f`: `png | svg | json | terminal` (inferred from extension)
- `--dark`: dark theme toggle
- Provider filters: `--claude`, `--codex`, `--opencode`
- `--since` / `--until`: date range filter (`YYYY-MM-DD`)
- `--days`: rolling window (default: 365)
- `--project`: filter to a specific Claude Code project directory
- `--compare`: diff two date ranges side-by-side
- `--wrapped`: generate "Year in Review" summary card
- `--badge`: output a README-compatible SVG badge (streak + total tokens)
- `--no-color`: disable ANSI colors in terminal output
- `--json`: shorthand for `--format json`
- `--version` / `-v`: print version
- `--help` / `-h`: usage info

### 2.2 Config File Support

- Read `~/.tokenleakrc` or `tokenleak.config.json` for defaults
- Supported config keys: `theme`, `outputPath`, `format`, `providers`, `costCurrency`
- CLI flags always override config file

### 2.3 Environment Knobs

- `TOKENLEAK_FILE_PROCESS_CONCURRENCY` (default: 4)
- `TOKENLEAK_MAX_JSONL_RECORD_BYTES` (default: 64 MB)
- `TOKENLEAK_PRICING_OVERRIDE`: path to custom pricing JSON file

---

## Phase 3 — PNG / SVG Renderer

> Goal: Beautiful, information-dense static image output.

### 3.1 Heatmap Grid

- Monday-first contribution-style grid (52 weeks × 7 days)
- Cell colour intensity mapped to token volume (5 buckets per provider colour)
- Empty days rendered as faint outline cells
- Month labels above grid
- Day-of-week labels (M W F) on left axis
- Tooltip-style data embedded in SVG (`<title>` tags) for hover in browsers

### 3.2 Top Stats Panel (per provider)

- `LAST 30 DAYS` token count
- `INPUT TOKENS` (all-time)
- `OUTPUT TOKENS` (all-time)
- `TOTAL TOKENS` (including cache)
- `ESTIMATED COST` (all-time, USD)
- `CACHE HIT RATE` (%)

### 3.3 Bottom Insights Panel (per provider)

- `MOST USED MODEL` (with token count)
- `RECENT MODEL` (last 30 days, with token count)
- `LONGEST STREAK` (days)
- `CURRENT STREAK` (days)
- `PEAK DAY` (date + token count)
- `AVG TOKENS/DAY`

### 3.4 Day-of-Week Bar Chart (optional panel)

- Small horizontal bar chart: Mon–Sun average token usage
- Highlights busiest day

### 3.5 Model Usage Bar Chart (optional panel)

- Top 5 models by total tokens, rendered as horizontal bars
- Colour-coded by provider

### 3.6 "Wrapped" Card Mode (`--wrapped`)

- Large-format card (1200×630, shareable aspect ratio)
- Year total tokens in giant typography
- Best streak, best day, favourite model
- Provider breakdown as mini pie or bar
- Subtle background gradient, Tokenleak branding

### 3.7 README Badge (`--badge`)

- Compact SVG badge: `Tokenleak | 🔥 42 day streak | 12.4M tokens`
- Auto-fits to GitHub dark/light via SVG `prefers-color-scheme`

### 3.8 Theme System

- Light theme (default)
- Dark theme (`--dark`)
- Per-provider accent colours
- Fonts: embed subset of a monospace font (e.g. JetBrains Mono subset) for crisp text

### 3.9 Rendering Engine

- Use `@napi-rs/canvas` or `skia-canvas` for PNG rendering (no headless browser dep)
- Use native string templating for SVG renderer
- Abstract `IRenderer` interface: `render(data: TokenleakOutput, opts: RenderOptions): Buffer | string`

---

## Phase 4 — Terminal Renderer

> Goal: Zero-friction, no-file-needed output right in the shell.

### 4.1 Heatmap (ANSI)

- Full-width ANSI heatmap using Unicode block characters (`█ ▓ ▒ ░ ·`)
- Respects terminal width (auto-detected via `process.stdout.columns`)
- Month labels, day-of-week labels
- Colour intensity via 256-colour or truecolor ANSI codes
- Graceful fallback to 16-colour if terminal doesn't support truecolor

### 4.2 Stats Dashboard (terminal)

- Summary table per provider using `cli-table3` or hand-rolled box drawing
- Streak indicator with fire emoji 🔥
- Cost estimate line
- Top 3 models table
- Peak day callout

### 4.3 Compact One-Liner Mode

- Single-line summary: `Claude Code · 30d: 4.2M tokens · 🔥 12 day streak · $18.40`
- Useful for shell prompts or status bars (output to stdout, pipe-friendly)

---

## Phase 5 — JSON Export

> Goal: Machine-readable output for downstream tools and interactive rendering.

- Top-level schema version: `"version": "2026-03-03"`
- Per-provider: `title`, `colors`, `daily[]`, `insights`, `costEstimate`
- `daily[]` item: `{ date, input, output, cache, total, cost, breakdown[] }`
- `breakdown[]` item: `{ model, tokens: { input, output, cache, total }, cost }`
- `insights`: `mostUsedModel`, `recentMostUsedModel`, `longestStreak`, `currentStreak`, `peakDay`, `avgTokensPerDay`, `cacheHitRate`
- `--compare` diff mode: includes `periodA`, `periodB`, and `delta` per metric

---

## Phase 6 — Sharing & Export Features

- `--upload gist`: anonymised JSON export posted to GitHub Gist, returns URL
- `--upload s3`: upload PNG/SVG to S3 (reads `AWS_*` env vars)
- `--clipboard`: copy terminal output or SVG to system clipboard (via `pbcopy` / `xclip` / `clip.exe`)
- `--open`: auto-open output file after generation (macOS: `open`, Linux: `xdg-open`, Windows: `start`)

---

## Phase 7 — Quality, DX & Polish

### 7.1 Error Handling

- Clear error messages for missing data directories
- Oversized JSONL record errors: name file, line number, byte cap, env var to raise limit
- Provider-not-found error distinguishes "no data" vs "directory missing"
- Exit code 1 on error, 0 on success

### 7.2 Testing

- Unit tests for aggregation engine (streaks, rolling windows, cost calc)
- Unit tests for each provider parser with fixture JSONL/DB files
- Snapshot tests for PNG renderer output (pixel-level or hash-based)
- Snapshot tests for terminal renderer (ANSI string output)
- Integration test: end-to-end CLI invocation with fixture data

### 7.3 Documentation

- `README.md`: install, usage, all flags, examples with screenshots
- `CONTRIBUTING.md`: how to add a new provider
- Inline JSDoc on all public types and functions
- `--help` output matches README

### 7.4 Release

- Publish to npm as `tokenleak`
- Binary builds via `bun build --compile` for macOS/Linux/Windows
- GitHub Actions CI: lint, test, build on push
- GitHub Actions release: publish npm + attach binaries on tag

---

## Prompt Plan for Claude Opus

> Use these prompts in sequence. Each prompt assumes the previous phase is complete. Always attach the current codebase and ask Opus to write production-quality TypeScript.

---

### Prompt 1 — Bootstrap & Types

```
You are building "Tokenleak", a CLI tool that generates token usage heatmaps for 
AI coding tools (Claude Code, Codex, Open Code). It supports PNG, SVG, terminal 
(ANSI), and JSON output.

Task: Bootstrap the monorepo and define all shared types.

Requirements:
1. Init a Bun + Turborepo monorepo with packages: cli, core, registry, renderers
2. Set up shared TypeScript config in tooling/typescript-config
3. In packages/core/src/types.ts, define these types with full JSDoc:
   - DailyUsage, ModelBreakdown, ProviderData, AggregatedStats, TokenleakOutput
   - RenderOptions (theme: 'light'|'dark', format, outputPath, dateRange, providers)
4. Export everything from packages/core/src/index.ts

Write clean, strict TypeScript (no `any`). Include bun.lock, package.json files.
```

---

### Prompt 2 — Provider Parsers

```
You are building the provider registry for Tokenleak (packages/registry).

Task: Implement IProvider and three concrete providers.

Reference the slopmeter repo (https://github.com/JeanMeijer/slopmeter) for the 
JSONL and SQLite parsing logic — port and improve it.

Requirements:
1. Define IProvider interface: { name, colors, isAvailable(): Promise<bool>, load(): Promise<ProviderData> }
2. Implement ClaudeCodeProvider: reads $CLAUDE_CONFIG_DIR/*/projects JSONL files
3. Implement CodexProvider: reads $CODEX_HOME/sessions JSONL files
4. Implement OpenCodeProvider: reads opencode.db SQLite or legacy JSON files
5. Shared bounded JSONL record splitter (memory-safe, respects TOKENLEAK_MAX_JSONL_RECORD_BYTES)
6. Model name normaliser: strip trailing `-YYYYMMDD` suffix
7. Cost estimator: pricing table for Claude 3/3.5/4, GPT-4o, o1, o3 families

All parsers must use streaming — no full-file materialisation in memory.
Concurrency: TOKENLEAK_FILE_PROCESS_CONCURRENCY (default 4).
```

---

### Prompt 3 — Aggregation Engine

```
You are building the aggregation engine for Tokenleak (packages/core).

Task: Implement all stat calculations on top of raw ProviderData.

Requirements:
1. aggregateProvider(data: ProviderData): AggregatedStats
2. Rolling window: last 30 days token totals (input, output, cache, total, cost)
3. Streak calculator: longest streak, current streak (consecutive days with any usage)
4. Peak day: date + token total
5. Day-of-week breakdown: average tokens for Mon–Sun across the date range
6. Hour-of-day breakdown: if timestamps available in data
7. Cache hit rate: cache tokens / total tokens
8. Average tokens per day (over days with usage, and over all days in range)
9. Top N models by total tokens (with cost per model)
10. mergeProviders(providers: AggregatedStats[]): combined totals

Write pure functions, fully unit-tested with Bun's built-in test runner.
Include at least 15 test cases covering edge cases (empty data, single day, streaks spanning month boundaries).
```

---

### Prompt 4 — PNG/SVG Renderer

```
You are building the image renderer for Tokenleak (packages/renderers).

Task: Implement PNG and SVG output using @napi-rs/canvas for PNG.

Requirements:
1. IRenderer interface: render(output: TokenleakOutput, opts: RenderOptions): Promise<Buffer | string>
2. PngRenderer and SvgRenderer implementing IRenderer
3. Heatmap grid:
   - Monday-first, 52 weeks × 7 days
   - 5-bucket colour intensity per provider accent colour
   - Month labels above, M/W/F day labels on left
   - Empty cells as faint outlines
4. Top stats panel (per provider): LAST 30 DAYS, INPUT, OUTPUT, TOTAL, COST, CACHE HIT RATE
5. Bottom insights panel: MOST USED MODEL, RECENT MODEL, LONGEST STREAK, CURRENT STREAK, PEAK DAY, AVG/DAY
6. Day-of-week mini bar chart below heatmap
7. Top 5 models horizontal bar chart
8. Light and dark themes
9. Wrapped card mode (1200×630): giant token total, best stats, provider breakdown
10. SVG <title> tags on each cell for hover tooltips

Use JetBrains Mono or a system monospace font. No headless browser dependencies.
```

---

### Prompt 5 — Terminal Renderer

```
You are building the terminal (ANSI) renderer for Tokenleak (packages/renderers).

Task: Implement a full terminal dashboard and compact one-liner.

Requirements:
1. TerminalRenderer implementing IRenderer — outputs ANSI string to stdout
2. Full heatmap: Unicode block chars (█ ▓ ▒ ░ ·) coloured with 256/truecolor ANSI
   - Auto-detect terminal width via process.stdout.columns
   - Graceful fallback to 16-colour mode
   - Month labels, day-of-week labels
3. Stats table per provider: box-drawing chars, no external table library
   - Streak with 🔥, cost, cache hit rate, peak day, avg/day, top 3 models
4. Multi-provider layout: providers stacked vertically with a divider
5. --no-color flag: plain text, no ANSI
6. Compact one-liner mode (--oneliner flag):
   "Claude Code · 30d: 4.2M tokens · 🔥 12 day streak · ~$18.40"
7. Pipe detection: if stdout is not a TTY, output plain text (no ANSI)

Test with fixture data. All box-drawing must align correctly at widths 80, 120, 160.
```

---

### Prompt 6 — CLI Wiring & Config

```
You are building the CLI entrypoint for Tokenleak (packages/cli).

Task: Wire all packages into a single polished CLI.

Requirements:
1. Argument parsing with citty (not yargs)
2. All flags from the spec: --output, --format, --dark, --since, --until, --days,
   --project, --compare, --wrapped, --badge, --no-color, --json, --claude, 
   --codex, --opencode, --upload (gist|s3), --open, --clipboard, --oneliner
3. Config file: read ~/.tokenleakrc (JSON) for defaults; CLI flags override
4. Env var support: TOKENLEAK_FILE_PROCESS_CONCURRENCY, TOKENLEAK_MAX_JSONL_RECORD_BYTES
5. Provider availability check: print which providers have data before rendering
6. --compare mode: render two date windows side-by-side with delta metrics
7. --badge: output compact SVG badge string to stdout or file
8. --upload gist: post anonymised JSON to GitHub Gist, print URL (requires GITHUB_TOKEN env)
9. --open: open output file after generation cross-platform
10. Clean error messages with exit code 1 on failure
11. Loading spinner during data ingestion (use nanospinner)
12. --version reads from package.json

Entry point: packages/cli/src/cli.ts
Binary: tokenleak
```

---

### Prompt 7 — Testing, Docs & Release

```
You are finalising Tokenleak for release.

Task: Add tests, documentation, and release automation.

Requirements:
1. Fixture data: generate synthetic JSONL files for Claude Code and Codex 
   covering 400 days of varied usage (sparse early, dense recent, streaks)
2. Integration tests: run CLI against fixture data, assert output files exist 
   and are valid PNG/SVG/JSON
3. Snapshot tests: ANSI terminal output, SVG content (key strings present)
4. GitHub Actions CI workflow: lint + test + build on push to main and PRs
5. GitHub Actions release workflow: on tag push, build binaries with 
   `bun build --compile` for darwin-arm64, darwin-x64, linux-x64, win32-x64;
   publish npm package; attach binaries to GitHub Release
6. README.md:
   - Install instructions (npm, bun, binary)
   - All flags with examples
   - Screenshot placeholder for heatmap
   - Provider setup (data locations)
   - Config file format
7. CONTRIBUTING.md: how to add a new provider (implement IProvider interface)

Ensure `bun run build && node packages/cli/dist/cli.js --help` works cleanly.
```

---

## Output Modes Summary


| Flag                | Output                           |
| ------------------- | -------------------------------- |
| *(default)*         | PNG heatmap file                 |
| `--format svg`      | SVG heatmap file                 |
| `--format json`     | Structured JSON export           |
| `--format terminal` | ANSI dashboard in shell          |
| `--wrapped`         | Shareable summary card (PNG/SVG) |
| `--badge`           | Compact SVG badge for README     |
| `--oneliner`        | Single line to stdout            |


---

## Milestone Checklist

- **M1**: Monorepo boots, types defined, all parsers return `ProviderData`
- **M2**: Aggregation engine complete with tests passing
- **M3**: PNG renderer produces correct heatmap for fixture data
- **M4**: Terminal renderer works at 80/120/160 columns
- **M5**: CLI wired end-to-end, all flags functional
- **M6**: Wrapped card + badge modes working
- **M7**: Tests green, README complete, CI passing
- **M8**: npm publish + binary release on GitHub

