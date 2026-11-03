import { instantiate, isRenderable, isVNode } from '@opentui/core';
import type { Renderable, RenderContext, VChild, VNode } from '@opentui/core';

type Props = Record<string, unknown>;

/** The props each reconciled renderable was last built or patched from. */
const appliedProps = new WeakMap<Renderable, Props>();

export interface ReconcileStats {
  /** Renderables reused and patched in place. */
  patched: number;
  /** Renderables built because nothing reusable stood in their place. */
  created: number;
  /** Renderables destroyed because the new tree no longer has them. */
  destroyed: number;
}

/**
 * Makes `parent`'s children match `children`, reusing renderables wherever
 * the type matches and every changed prop has a setter.
 *
 * The views describe each frame as a fresh tree of `Box()`/`Text()` nodes.
 * Mounting that tree from scratch every frame cost native text buffers and
 * layout nodes that OpenTUI never released (megabytes per frame), so frames
 * patch the live tree instead and destroy only what is replaced or removed.
 * A node is rebuilt when patching could leave it different from a fresh
 * build: a prop was removed, `id` changed, a prop has no setter, or the node
 * carries queued method calls or delegates.
 */
export function reconcileChildren(
  ctx: RenderContext,
  parent: Renderable,
  children: readonly VChild[],
  stats: ReconcileStats = { patched: 0, created: 0, destroyed: 0 },
): ReconcileStats {
  const wanted = flatten(children);
  for (let index = 0; index < wanted.length; index++) {
    const node = wanted[index]!;
    const current = parent.getChildren()[index];

    if (isRenderable(node)) {
      if (current !== node) parent.add(node, index);
      continue;
    }

    if (current && canPatch(current, node)) {
      patch(current, (node.props ?? {}) as Props);
      stats.patched += 1;
      reconcileChildren(ctx, current, node.children ?? [], stats);
      continue;
    }

    const created = instantiate(ctx, node);
    rememberProps(created, node);
    stats.created += 1;
    parent.add(created, index);
    if (current) {
      current.destroyRecursively();
      stats.destroyed += 1;
    }
  }

  for (const extra of parent.getChildren().slice(wanted.length)) {
    extra.destroyRecursively();
    stats.destroyed += 1;
  }
  return stats;
}

function flatten(children: readonly VChild[]): (VNode | Renderable)[] {
  const out: (VNode | Renderable)[] = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flatten(child));
    else if (child) out.push(child);
  }
  return out;
}

function rememberProps(renderable: Renderable, node: VNode): void {
  appliedProps.set(renderable, { ...((node.props ?? {}) as Props) });
  // Children of a fresh mount were built from these vnodes too.
  const children = flatten(node.children ?? []);
  const mounted = renderable.getChildren();
  children.forEach((child, index) => {
    const built = mounted[index];
    if (built && isVNode(child)) rememberProps(built, child);
  });
}

function hasSetter(target: object, key: string): boolean {
  for (let proto: object | null = target; proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor) return typeof descriptor.set === 'function';
  }
  return false;
}

function canPatch(current: Renderable, node: VNode): boolean {
  if (current.constructor !== node.type) return false;
  if (node.__pendingCalls?.length || node.__delegateMap) return false;
  const previous = appliedProps.get(current);
  if (!previous) return false;
  const next = (node.props ?? {}) as Props;
  for (const key of Object.keys(previous)) {
    if (!(key in next)) return false;
  }
  for (const [key, value] of Object.entries(next)) {
    if (Object.is(previous[key], value)) continue;
    if (key === 'id' || !hasSetter(current, key)) return false;
  }
  return true;
}

function patch(current: Renderable, next: Props): void {
  const previous = appliedProps.get(current) ?? {};
  const target = current as unknown as Props;
  for (const [key, value] of Object.entries(next)) {
    if (!Object.is(previous[key], value)) target[key] = value;
  }
  appliedProps.set(current, { ...next });
}
