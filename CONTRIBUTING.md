# Contributing to Tokenleak

Thank you for your interest in contributing to Tokenleak. This document covers the development setup, workflow, code style, and testing requirements.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.0.7 or later
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/ya-nsh/tokenleak.git
cd tokenleak

# Install dependencies
bun install

# Build all packages
bun run build

# Run all tests
bun run test

# Lint
bun run lint

# Format
bun run format
```

### Package Structure

| Package | Path | Description |
|---------|------|-------------|
| `@tokenleak/core` | `packages/core` | Shared types, constants, aggregation engine |
| `@tokenleak/registry` | `packages/registry` | Provider parsers (Claude Code, Codex, Open Code) |
| `@tokenleak/renderers` | `packages/renderers` | Output renderers (JSON, SVG, PNG, terminal) |
| `tokenleak` | `packages/cli` | CLI entrypoint |

## PR Workflow

1. Create a branch from `main` using the naming convention:
   - `feat/<short-description>` for new features
   - `fix/<short-description>` for bug fixes
   - `chore/<short-description>` for maintenance tasks
   - `test/<short-description>` for test-only changes

2. Make your changes with clean, atomic commits using conventional commit messages:
   - `feat: add streak calculator`
   - `fix: handle empty JSONL files gracefully`
   - `test: add edge cases for rolling window aggregator`
   - `chore: update dependencies`

3. Ensure `bun run build` and `bun run test` pass locally before opening a PR.

4. Open a PR against `main` with a structured description including What, Why, How, Test Coverage, and a Checklist.

5. Never commit directly to `main`.

## Code Style

- **Strict TypeScript**: No `any` types. Use `unknown` and narrow properly.
- **No unhandled promise rejections**: Always catch or propagate errors.
- **Clear error messages**: Errors should include context (file path, line number, etc.) and exit with code 1.
- **No magic numbers**: Use named constants defined in `@tokenleak/core`.
- **Small functions**: Each function should have a single, clear purpose.
- **JSDoc**: All public types and exported functions should have JSDoc comments.

## Testing Requirements

All new code must include tests. Use Bun's built-in test runner (`bun:test`).

### Minimum Requirements

- Every new function has at least one happy-path test.
- Every new function has at least one failure or edge-case test.
- Aim for at least 80% coverage on new files.

### Provider-specific Tests

- Happy path: valid JSONL/SQLite with realistic data.
- Empty file handling.
- Missing directory (`isAvailable` returns `false`, does not throw).
- Oversized record: fails with a clear error message.
- Model name normalisation: strips date suffixes correctly.
- Cost calculation: known model + known token count = expected cost.

### Aggregation Tests

- Streak: no usage = 0, single day = 1, gap resets streak.
- Streak spanning month and year boundaries.
- Rolling 30-day window excludes data outside the window.
- Peak day with ties (pick the most recent).
- Cache hit rate: 0 cache = 0%, all cache = 100%.
- Empty provider data returns zeroed stats without throwing.

### Adding a New Provider

To add a new AI coding tool provider:

1. Create a new file in `packages/registry/src/providers/`.
2. Implement the `IProvider` interface from `@tokenleak/core`:
   - `name`: unique identifier (e.g., `"my-tool"`)
   - `displayName`: human-readable name
   - `colors`: accent colours for rendering
   - `isAvailable()`: returns `true` if the tool's data directory exists
   - `load(dateRange?)`: reads and returns `ProviderData`
3. Register the provider in `packages/registry/src/index.ts`.
4. Add tests in `packages/registry/src/providers/__tests__/`.
5. Open a PR with the provider and its tests.
