#!/usr/bin/env bun
/**
 * Prepares the dist/ directory for npm publishing.
 * Copies a clean package.json into dist/ with the right metadata.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const rootPkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const cliPkg = JSON.parse(readFileSync('packages/cli/package.json', 'utf-8'));

const publishPkg = {
  name: 'tokenleak',
  version: cliPkg.version,
  description: 'Visualise your AI coding-assistant token usage across providers — heatmaps, dashboards, and shareable cards.',
  type: 'module',
  bin: {
    tokenleak: 'tokenleak',
  },
  files: ['tokenleak'],
  dependencies: {
    sharp: '^0.34.0',
  },
  engines: {
    bun: '>=1.0.0',
  },
  keywords: [
    'ai',
    'tokens',
    'usage',
    'claude',
    'codex',
    'opencode',
    'heatmap',
    'dashboard',
    'cli',
  ],
  repository: {
    type: 'git',
    url: 'git+https://github.com/ya-nsh/tokenleak.git',
  },
  license: 'MIT',
  author: 'ya-nsh',
};

writeFileSync(join('dist', 'package.json'), JSON.stringify(publishPkg, null, 2) + '\n');

// Copy README if it exists
try {
  copyFileSync('README.md', join('dist', 'README.md'));
} catch {
  // README is optional
}

console.log(`Prepared dist/package.json for tokenleak@${publishPkg.version}`);
