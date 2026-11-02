import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as registry from './index';
import type { IProvider } from './provider';

const README = readFileSync(join(import.meta.dir, '..', '..', '..', 'README.md'), 'utf8');

/** The Overview table: the header row and the table rows directly after it. */
function overviewTable(source: string = README): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith('| Icon | Client |'));
  if (start === -1) return '';
  const rows: string[] = [];
  for (let i = start; i < lines.length && lines[i]!.startsWith('|'); i++) rows.push(lines[i]!);
  return rows.join('\n');
}

function builtInProviders(): IProvider[] {
  return Object.entries(registry)
    .filter(([name, value]) => name.endsWith('Provider') && typeof value === 'function')
    .map(([, value]) => new (value as new () => IProvider)())
    .filter((provider) => typeof provider.name === 'string' && typeof provider.isAvailable === 'function');
}

describe('README provider overview', () => {
  test('finds the provider classes', () => {
    expect(builtInProviders().length).toBeGreaterThanOrEqual(25);
  });

  test('only reads the table, not prose that mentions provider keys', () => {
    expect(overviewTable('| Icon | Client |\n| a | `x` |\n\nLater text mentions `y`.')).not.toContain('`y`');
  });

  test('lists every built-in provider by its provider key', () => {
    const table = overviewTable();
    const missing = builtInProviders()
      .map((provider) => provider.name)
      .filter((name) => !table.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });
});
