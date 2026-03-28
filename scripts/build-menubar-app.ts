#!/usr/bin/env bun
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dir, '..');
const sourceFile = join(rootDir, 'packages', 'menubar', 'App', 'TokenleakUsage.swift');
const outputApp = join(rootDir, 'packages', 'menubar', 'dist', 'Tokenleak Usage.app');
const outputExecutable = join(outputApp, 'Contents', 'MacOS', 'Tokenleak Usage');
const infoPlist = join(outputApp, 'Contents', 'Info.plist');
const cliPackage = (await Bun.file(join(rootDir, 'packages', 'cli', 'package.json')).json()) as {
  version: string;
};

if (process.platform !== 'darwin') {
  console.log('Skipping menubar app build on non-macOS host.');
  process.exit(0);
}

if (!existsSync(sourceFile)) {
  console.error(`Missing source file: ${sourceFile}`);
  process.exit(1);
}

rmSync(outputApp, { recursive: true, force: true });
mkdirSync(dirname(outputExecutable), { recursive: true });

const compile = Bun.spawnSync(
  [
    '/usr/bin/swiftc',
    sourceFile,
    '-o',
    outputExecutable,
    '-framework',
    'AppKit',
    '-framework',
    'Foundation',
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
