# Tokenleak

A CLI tool that surfaces your AI coding-assistant token usage as beautiful heatmaps, terminal dashboards, and shareable cards. Supports **Claude Code**, **Codex**, and **Open Code**.

## Features

- Heatmap visualisation of daily token usage (contribution-graph style)
- Terminal dashboard with ANSI colours and Unicode block characters
- SVG and PNG image export for sharing
- JSON export for downstream tooling
- Streak tracking (current and longest)
- Cost estimation with per-model pricing
- Rolling 30-day window statistics
- Day-of-week usage breakdown
- Multi-provider support with automatic detection
- Configuration file support (`~/.tokenleakrc`)

## Quick Start

```bash
# Install globally with bun
bun install -g tokenleak

# Or clone and build from source
git clone https://github.com/ya-nsh/tokenleak.git
cd tokenleak
bun install
bun run build

# Run
bun run packages/cli/dist/cli.js
```

## Usage

```bash
# Terminal dashboard (default)
tokenleak

# JSON output
tokenleak --format json

# SVG heatmap
tokenleak --format svg --output usage.svg

# PNG heatmap
tokenleak --format png --output usage.png

# Filter to last 90 days
tokenleak --days 90

# Custom date range
tokenleak --since 2025-01-01 --until 2025-12-31

# Filter to a specific provider
tokenleak --provider claude-code

# Compare two date ranges
tokenleak --compare 2025-01-01..2025-06-30

# Dark theme (default) / light theme
tokenleak --theme light

# Disable ANSI colours
tokenleak --no-color

# Write output to a file (format inferred from extension)
tokenleak --output report.json
```

### All Flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--format` | `-f` | Output format: `json`, `svg`, `png`, `terminal` |
| `--theme` | `-t` | Colour theme: `dark`, `light` |
| `--since` | `-s` | Start date (`YYYY-MM-DD`) |
| `--until` | `-u` | End date (`YYYY-MM-DD`), defaults to today |
| `--days` | `-d` | Number of days to look back (default: 365) |
| `--output` | `-o` | Output file path |
| `--width` | `-w` | Terminal width (default: 80) |
| `--no-color` | | Disable ANSI colours in terminal output |
| `--no-insights` | | Hide the insights panel |
| `--compare` | | Compare two date ranges (`YYYY-MM-DD..YYYY-MM-DD`) |
| `--provider` | `-p` | Filter to specific provider(s), comma-separated |
| `--version` | `-v` | Print version |
| `--help` | `-h` | Print usage information |

## Supported Providers

### Claude Code

Reads JSONL conversation logs from the Claude Code configuration directory.

- **macOS/Linux**: `~/.claude/projects/*/`
- **Custom**: Set `CLAUDE_CONFIG_DIR` environment variable

### Codex

Reads JSONL session logs from the Codex home directory.

- **Default**: `~/.codex/sessions/`
- **Custom**: Set `CODEX_HOME` environment variable

### Open Code

Reads usage data from the Open Code SQLite database or legacy JSON files.

- **Default**: `~/.opencode/opencode.db`

## Configuration

Create a `~/.tokenleakrc` file with JSON to set defaults:

```json
{
  "format": "terminal",
  "theme": "dark",
  "days": 365,
  "width": 120,
  "noColor": false,
  "noInsights": false
}
```

CLI flags always override configuration file values.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TOKENLEAK_FILE_PROCESS_CONCURRENCY` | `4` | Number of files to process concurrently |
| `TOKENLEAK_MAX_JSONL_RECORD_BYTES` | `67108864` (64 MB) | Maximum size of a single JSONL record |
| `TOKENLEAK_PRICING_OVERRIDE` | | Path to a custom pricing JSON file |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code configuration directory |
| `CODEX_HOME` | `~/.codex` | Codex home directory |

## Output Formats

| Format | Description |
|--------|-------------|
| `terminal` | ANSI dashboard with heatmap and stats, rendered in the shell |
| `json` | Structured JSON export with daily data, insights, and aggregated stats |
| `svg` | SVG heatmap with stats and insights panels |
| `png` | PNG heatmap rendered via `@napi-rs/canvas` |

## Project Structure

```
tokenleak/
  packages/
    cli/           -- Main CLI entrypoint
    core/          -- Data types, aggregation engine
    registry/      -- Provider parsers (Claude Code, Codex, Open Code)
    renderers/     -- JSON, SVG, PNG, terminal renderers
  tooling/
    typescript-config/
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, PR workflow, and coding guidelines.

## License

MIT
