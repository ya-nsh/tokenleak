#!/usr/bin/env bun
/**
 * Build script that bundles the CLI into a single file for npm publishing.
 * Outputs to dist/tokenleak.js with sharp as an external dependency.
 */
import { $ } from 'bun';

// Bundle CLI with all internal deps, keeping native deps external
const result = await Bun.build({
  entrypoints: ['packages/cli/src/cli.ts'],
  outdir: 'dist',
  target: 'bun',
  external: ['sharp'],
  naming: 'tokenleak.js',
  minify: false,
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Make executable
await $`chmod +x dist/tokenleak.js`;

console.log(`Built dist/tokenleak.js (${(result.outputs[0].size / 1024).toFixed(1)} KB)`);
