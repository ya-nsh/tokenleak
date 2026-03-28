#!/usr/bin/env bun
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dir, '..');
const sourceDir = join(rootDir, 'packages', 'menubar', 'App');

function collectSwiftFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries
    .flatMap((entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectSwiftFiles(fullPath);
      }
      return entry.name.endsWith('.swift') ? [fullPath] : [];
    })
    .sort();
}

if (process.platform !== 'darwin') {
  console.log('Skipping menubar app checks on non-macOS host.');
  process.exit(0);
}

if (!existsSync(sourceDir)) {
  console.error(`Missing source directory: ${sourceDir}`);
  process.exit(1);
}

const sourceFiles = collectSwiftFiles(sourceDir);
if (sourceFiles.length === 0) {
  console.error(`No Swift sources found in: ${sourceDir}`);
  process.exit(1);
}

const proc = Bun.spawnSync(
  [
    '/usr/bin/swiftc',
    '-typecheck',
    ...sourceFiles,
    '-framework',
    'AppKit',
    '-framework',
    'Foundation',
    '-framework',
    'SwiftUI',
    '-framework',
    'Security',
  ],
  {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  },
);

process.exit(proc.exitCode ?? 0);
