#!/usr/bin/env bun
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dir, '..');
const sourceDir = join(rootDir, 'packages', 'menubar', 'App');
const outputApp = join(rootDir, 'packages', 'menubar', 'dist', 'Tokenleak Usage.app');
const outputExecutable = join(outputApp, 'Contents', 'MacOS', 'Tokenleak Usage');
const infoPlist = join(outputApp, 'Contents', 'Info.plist');
const cliPackage = (await Bun.file(join(rootDir, 'packages', 'cli', 'package.json')).json()) as {
  version: string;
};

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
  console.log('Skipping menubar app build on non-macOS host.');
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

rmSync(outputApp, { recursive: true, force: true });
mkdirSync(dirname(outputExecutable), { recursive: true });

const compile = Bun.spawnSync(
  [
    '/usr/bin/swiftc',
    ...sourceFiles,
    '-o',
    outputExecutable,
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

if (compile.exitCode !== 0) {
  process.exit(compile.exitCode ?? 1);
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>Tokenleak Usage</string>
  <key>CFBundleIdentifier</key>
  <string>com.tokenleak.menubar</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Tokenleak Usage</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${cliPackage.version}</string>
  <key>CFBundleVersion</key>
  <string>${cliPackage.version}</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

writeFileSync(infoPlist, plist);
chmodSync(outputExecutable, 0o755);

const sign = Bun.spawnSync(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', outputApp], {
  stdout: 'inherit',
  stderr: 'inherit',
});

if (sign.exitCode !== 0) {
  process.exit(sign.exitCode ?? 1);
}

console.log(outputApp);
