/** Cells a tab label occupies, including its one-space padding on each side. */
export function tabWidth(label: string): number {
  return label.length + 2;
}

/** Width of the `‹ ` / ` ›` markers shown when tabs are hidden on that side. */
export const OVERFLOW_MARKER_WIDTH = 2;

export interface TabWindow {
  /** First visible tab index, inclusive. */
  start: number;
  /** Last visible tab index, exclusive. */
  end: number;
}

/**
 * Pick a contiguous run of tabs around the active one that fits `budget`
 * cells, growing right then left alternately so the active tab stays near
 * the middle. Overflow markers are reserved only when something is hidden.
 */
export function fitTabWindow(labels: readonly string[], activeIndex: number, budget: number): TabWindow {
  if (labels.length === 0) return { start: 0, end: 0 };
  const active = Math.min(Math.max(activeIndex, 0), labels.length - 1);
  const total = labels.reduce((sum, label) => sum + tabWidth(label), 0);
  if (total <= budget) return { start: 0, end: labels.length };

  const cost = (start: number, end: number): number => {
    let width = 0;
    for (let i = start; i < end; i++) width += tabWidth(labels[i]!);
    if (start > 0) width += OVERFLOW_MARKER_WIDTH;
    if (end < labels.length) width += OVERFLOW_MARKER_WIDTH;
    return width;
  };

  let start = active;
  let end = active + 1;
  let growRight = true;
  for (;;) {
    const canRight = end < labels.length && cost(start, end + 1) <= budget;
    const canLeft = start > 0 && cost(start - 1, end) <= budget;
    if (!canRight && !canLeft) break;
    if ((growRight && canRight) || !canLeft) end += 1;
    else start -= 1;
    growRight = !growRight;
  }
  return { start, end };
}

export interface Hint {
  text: string;
  /** Lower numbers survive longer when space runs out. */
  priority: number;
}

const HINT_SEPARATOR = '  ';

/**
 * Join keyboard hints in their given order, dropping the least important
 * ones until the line fits, so `q:quit` never gets cut to `q:`.
 */
export function fitHints(hints: readonly Hint[], budget: number): string {
  const kept = hints.map((hint, index) => ({ ...hint, index }));
  const render = () => kept.map((hint) => hint.text).join(HINT_SEPARATOR);
  while (kept.length > 1 && render().length > budget) {
    let drop = 0;
    for (let i = 1; i < kept.length; i++) {
      if (kept[i]!.priority > kept[drop]!.priority) drop = i;
    }
    kept.splice(drop, 1);
  }
  return render();
}
