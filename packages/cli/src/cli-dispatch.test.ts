import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dir, 'cli.ts');

async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', CLI_PATH, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe('subcommand dispatch', () => {
  // Each subcommand answers --help without loading provider data.
  const HELP_MARKERS: Array<[string, string]> = [
    ['behavior-diff', 'tokenleak behavior-diff'],
    ['explain', 'tokenleak explain'],
    ['commons', 'tokenleak commons'],
    ['cursor', 'tokenleak cursor'],
    ['focus', 'tokenleak focus'],
    ['nutrition', 'tokenleak nutrition'],
    ['pricing', 'tokenleak pricing'],
    ['receipts', 'tokenleak receipts'],
    ['replay', 'tokenleak replay'],
    ['serve', 'tokenleak serve'],
    ['simulate-routing', 'tokenleak simulate-routing'],
    ['statusline', 'tokenleak statusline'],
    ['usage', 'tokenleak usage'],
    ['waste', 'tokenleak waste'],
  ];

  for (const [command, marker] of HELP_MARKERS) {
    test(`${command} --help routes to its own help text`, async () => {
      const { exitCode, stdout } = await runCli([command, '--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(marker);
    });
  }

  test('a subcommand --version prints the version and schema', async () => {
    const { exitCode, stdout } = await runCli(['waste', '--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^tokenleak \d+\.\d+\.\d+\nschema /);
  });

  test('a subcommand error exits 1 with the error message', async () => {
    const { exitCode, stderr } = await runCli(['waste', '--severity']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Missing value for --severity');
  });

  test('explain answers --help after a date too, and still requires a date otherwise', async () => {
    const withDate = await runCli(['explain', '2026-01-01', '--help']);
    expect(withDate.exitCode).toBe(0);
    expect(withDate.stdout).toContain('tokenleak explain');

    const missing = await runCli(['explain']);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('requires a <date> argument');
  });

  test.each(['constructor', 'toString', '__proto__'])(
    'a prototype name like %p is an unknown command, not a crash',
    async (word) => {
      const { exitCode, stderr } = await runCli([word]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`Unknown command "${word}"`);
    },
  );

  test('a misspelled subcommand is rejected with a suggestion', async () => {
    const { exitCode, stderr } = await runCli(['wste']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Did you mean `tokenleak waste`?');
  });
});
