import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Box, Renderable, Text } from '@opentui/core';
import type { CliRenderer, VChild } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { reconcileChildren } from './reconcile';

type Harness = Awaited<ReturnType<typeof createTestRenderer>>;
let harness: Harness;
let fresh: Harness;

beforeEach(async () => {
  harness = await createTestRenderer({ width: 60, height: 12 });
  fresh = await createTestRenderer({ width: 60, height: 12 });
});

afterEach(() => {
  harness.renderer.destroy();
  fresh.renderer.destroy();
});

async function frame(h: Harness, tree: VChild): Promise<string> {
  reconcileChildren(h.renderer as CliRenderer, h.renderer.root, [tree]);
  await h.renderOnce();
  return h.captureCharFrame();
}

async function freshFrame(tree: VChild): Promise<string> {
  for (const child of fresh.renderer.root.getChildren()) child.destroyRecursively();
  fresh.renderer.root.add(tree as Parameters<typeof fresh.renderer.root.add>[0]);
  await fresh.renderOnce();
  return fresh.captureCharFrame();
}

const list = (rows: string[], color = '#ff0000') =>
  Box(
    { flexDirection: 'column', border: true, borderStyle: 'single', title: ` ${rows.length} rows `, width: '100%' },
    ...rows.map((row) => Text({ content: row, fg: color })),
  );

describe('reconcileChildren', () => {
  test('patches text and colours in place instead of rebuilding', async () => {
    await frame(harness, list(['a', 'b']));
    const before = harness.renderer.root.getChildren()[0]!.getChildren();
    const stats = reconcileChildren(harness.renderer as CliRenderer, harness.renderer.root, [list(['c', 'd'], '#00ff00')]);
    expect(stats).toEqual({ patched: 3, created: 0, destroyed: 0 });
    expect(harness.renderer.root.getChildren()[0]!.getChildren()).toEqual(before);
  });

  test('adds and destroys children as the list grows and shrinks', async () => {
    await frame(harness, list(['a']));
    let stats = reconcileChildren(harness.renderer as CliRenderer, harness.renderer.root, [list(['a', 'b', 'c'])]);
    expect(stats.created).toBe(2);
    stats = reconcileChildren(harness.renderer as CliRenderer, harness.renderer.root, [list(['a'])]);
    expect(stats.destroyed).toBe(2);
    expect(harness.renderer.root.getChildren()[0]!.getChildren()).toHaveLength(1);
  });

  test('rebuilds a node whose type changed or whose prop was removed', async () => {
    await frame(harness, Box({ flexDirection: 'column' }, Text({ content: 'x', fg: '#ff0000' })));
    let stats = reconcileChildren(harness.renderer as CliRenderer, harness.renderer.root, [
      Box({ flexDirection: 'column' }, Box({ height: 1 })),
    ]);
    expect(stats.created).toBe(1);
    expect(stats.destroyed).toBe(1);
    const outer = harness.renderer.root.getChildren()[0];
    // Dropping flexDirection cannot be patched; the subtree is rebuilt as one.
    stats = reconcileChildren(harness.renderer as CliRenderer, harness.renderer.root, [Box({}, Box({ height: 1 }))]);
    expect(stats).toEqual({ patched: 0, created: 1, destroyed: 1 });
    expect(harness.renderer.root.getChildren()[0]).not.toBe(outer);
  });

  test('destroyed renderables leave the global registry', async () => {
    const registry = (Renderable as unknown as { renderablesByNumber: Map<number, Renderable> }).renderablesByNumber;
    await frame(harness, list(['a', 'b', 'c']));
    const size = registry.size;
    for (let i = 0; i < 20; i++) {
      await frame(harness, i % 2 ? list(['a', 'b', 'c']) : Box({}, Text({ content: `${i}` })));
    }
    await frame(harness, list(['a', 'b', 'c']));
    expect(registry.size).toBe(size);
  });

  test('every patched frame matches a fresh build of the same tree', async () => {
    const trees = [
      list(['alpha', 'beta']),
      list(['gamma', 'delta', 'epsilon'], '#00ff00'),
      Box({ flexDirection: 'row', gap: 2 }, Text({ content: 'left' }), Text({ content: 'right', bg: '#333333' })),
      list([]),
      list(['zeta'], '#0000ff'),
      Box({ flexDirection: 'column', paddingLeft: 3 }, list(['nested']), Text({ content: 'tail' })),
    ];
    for (let round = 0; round < 3; round++) {
      for (const tree of round % 2 ? [...trees].reverse() : trees) {
        expect(await frame(harness, tree)).toBe(await freshFrame(tree));
      }
    }
  });
});
