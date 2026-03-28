#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dir, '..');
const buildScript = join(rootDir, 'scripts', 'build-menubar-app.ts');
const appPath = join(rootDir, 'packages', 'menubar', 'dist', 'Tokenleak Usage.app');
const outDir = join(rootDir, 'dist-menubar');
const zipPath = join(outDir, 'tokenleak-menubar-macos-universal.zip');

if (process.platform !== 'darwin') {
  console.log('Skipping menubar packaging on non-macOS host.');
  process.exit(0);
}

const build = Bun.spawnSync([process.execPath, buildScript], {
  cwd: rootDir,
  stdout: 'inherit',
  stderr: 'inherit',
});

if (build.exitCode !== 0) {
  process.exit(build.exitCode ?? 1);
}

if (!existsSync(appPath)) {
  console.error(`Built app bundle not found: ${appPath}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

const zip = Bun.spawnSync(
  ['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath],
  {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  },
);

if (zip.exitCode !== 0) {
  process.exit(zip.exitCode ?? 1);
}

console.log(zipPath);
