#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dir, '..');
const sourceFile = join(rootDir, 'packages', 'menubar', 'App', 'TokenleakUsage.swift');

if (process.platform !== 'darwin') {
  console.log('Skipping menubar app checks on non-macOS host.');
  process.exit(0);
}

if (!existsSync(sourceFile)) {
  console.error(`Missing source file: ${sourceFile}`);
  process.exit(1);
}

const proc = Bun.spawnSync(
  ['/usr/bin/swiftc', '-typecheck', sourceFile, '-framework', 'AppKit', '-framework', 'Foundation'],
  {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  },
);

process.exit(proc.exitCode ?? 0);
