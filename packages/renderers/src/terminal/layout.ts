export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function padVisible(text: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(text));
  return text + ' '.repeat(padding);
}

export function truncateVisible(text: string, width: number): string {
  if (width <= 0) return '';
  const plain = stripAnsi(text);
  if (plain.length <= width) return text;

  const limit = width <= 1 ? width : width - 1;
  let visibleCount = 0;
  let index = 0;
  let result = '';
  let sawAnsi = false;

  while (index < text.length && visibleCount < limit) {
    if (text[index] === '\x1b') {
      const match = text.slice(index).match(/^\x1b\[[0-9;?]*[A-Za-z]/);
      if (match) {
        result += match[0];
        index += match[0].length;
        sawAnsi = true;
        continue;
      }
    }

    result += text[index]!;
    index += 1;
    visibleCount += 1;
  }

  return sawAnsi ? `${result}…\x1b[0m` : `${result}…`;
}

export function clampVisible(text: string, width: number): string {
  return truncateVisible(text, width);
}

export function renderColumns(
  left: string[],
  right: string[],
  totalWidth: number,
  leftRatio = 0.5,
  gutter = 3,
): string[] {
  const safeWidth = Math.max(12, totalWidth);
  const leftWidth = Math.max(18, Math.floor((safeWidth - gutter) * leftRatio));
  const rightWidth = Math.max(18, safeWidth - leftWidth - gutter);
  const rows = Math.max(left.length, right.length);
  const lines: string[] = [];

  for (let index = 0; index < rows; index += 1) {
    const leftLine = clampVisible(left[index] ?? '', leftWidth);
    const rightLine = clampVisible(right[index] ?? '', rightWidth);
    lines.push(`${padVisible(leftLine, leftWidth)}${' '.repeat(gutter)}${rightLine}`);
  }

  return lines;
}
