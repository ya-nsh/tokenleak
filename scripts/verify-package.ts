#!/usr/bin/env bun
/** Install the actual npm tarball in isolation and exercise its installed CLI. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dir, '..');
const temp = mkdtempSync(join(tmpdir(), 'tokenleak-package-'));
const env = { ...process.env, PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}` };

function run(command: string[], cwd: string, extraEnv: Record<string, string> = {}): string {
  const result = Bun.spawnSync(command, { cwd, env: { ...env, ...extraEnv }, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`${command[0]} failed (${result.exitCode}): ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

try {
  const metadata = JSON.parse(readFileSync(join(root, 'dist', 'package.json'), 'utf8')) as { version: string };
  const packed = JSON.parse(run(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', temp], join(root, 'dist'))) as { filename: string }[];
  const filename = packed[0]?.filename;
  if (!filename) throw new Error('npm pack did not produce a package');
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ private: true,
    dependencies: { tokenleak: `file:${join(temp, filename)}` } }));
  run([process.execPath, 'install', '--ignore-scripts'], temp);

  const cli = join(temp, 'node_modules', '.bin', 'tokenleak');
  if (!run([cli, '--version'], temp).includes(metadata.version)) {
    throw new Error('Installed launcher did not report the packaged version');
  }
  const codexDir = join(temp, 'codex');
  mkdirSync(join(codexDir, 'sessions'), { recursive: true });
  const timestamp = '2026-03-12T10:00:00Z';
  const usage = { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 200 };
  const records = [
    { type: 'turn_context', timestamp, payload: { model: 'gpt-5.6-sol', service_tier: 'fast', turn_id: 'smoke-turn' } },
    { type: 'session_meta', timestamp, payload: { base_instructions: { text: 'You are Codex, based on GPT-5.' } } },
    { type: 'token_usage_record', timestamp, payload: { turn_id: 'smoke-turn', response_id: 'smoke-response', usage } },
    { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } } },
  ];
  writeFileSync(join(codexDir, 'sessions', 'smoke.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'));
  const report = JSON.parse(run([cli, '--codex', '--since', '2026-03-12', '--until', '2026-03-12', '--format', 'json'], temp,
    { CODEX_HOME: codexDir })) as { aggregated: { totalTokens: number; totalCost: number; topModels: { model: string }[] } };
  if (report.aggregated.totalTokens !== 1100 || report.aggregated.topModels[0]?.model !== 'gpt-5.6-sol' ||
      Math.abs(report.aggregated.totalCost - 0.01056) > 1e-9) {
    throw new Error('Installed CLI failed the model/tier/duplicate usage smoke test');
  }
  console.log(`Verified tokenleak@${metadata.version}: tarball installation, executable launcher, and usage report.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
