#!/usr/bin/env bun
/**
 * Build script that bundles the CLI into a single file for npm publishing.
 * Outputs to dist/tokenleak with sharp as an external dependency.
 */
import { $ } from 'bun';

// Bundle CLI with all internal deps, keeping native deps external
const result = await Bun.build({
  entrypoints: ['packages/cli/src/cli.ts'],
  outdir: 'dist',
  target: 'bun',
  external: ['sharp', '@opentui/core'],
  naming: 'tokenleak',
  minify: false,
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// The TUI's data engine runs in a worker, which Bun.build does not follow from
// `new Worker(...)`. Ship it as its own file beside the executable, where
// packages/tui/src/lib/engine.ts looks for it.
const engine = await Bun.build({
  entrypoints: ['packages/tui/src/lib/engine-worker.ts'],
  outdir: 'dist',
  target: 'bun',
  external: ['sharp', '@opentui/core'],
  naming: 'tokenleak-engine.js',
  minify: false,
});

if (!engine.success) {
  console.error('Engine worker build failed:');
  for (const log of engine.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Make executable
await $`chmod +x dist/tokenleak`;

console.log(`Built dist/tokenleak (${(result.outputs[0].size / 1024).toFixed(1)} KB)`);
console.log(`Built dist/tokenleak-engine.js (${(engine.outputs[0].size / 1024).toFixed(1)} KB)`);
