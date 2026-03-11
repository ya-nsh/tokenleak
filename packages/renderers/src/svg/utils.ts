/** Escape XML special characters to prevent injection */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Create an SVG rect element */
export function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  rx?: number,
): string {
  const rxAttr = rx !== undefined ? ` rx="${rx}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXml(fill)}"${rxAttr}/>`;
}

/** Create an SVG text element */
export function text(
  x: number,
  y: number,
  content: string,
  attrs?: Record<string, string | number>,
): string {
  const attrStr = attrs
    ? Object.entries(attrs)
        .map(([k, v]) => ` ${k}="${typeof v === 'string' ? escapeXml(v) : v}"`)
        .join('')
    : '';
  return `<text x="${x}" y="${y}"${attrStr}>${escapeXml(content)}</text>`;
}

/** Create an SVG g (group) element */
export function group(children: string[], transform?: string): string {
  const transformAttr = transform
    ? ` transform="${escapeXml(transform)}"`
    : '';
  return `<g${transformAttr}>${children.join('')}</g>`;
}

/** Format a number with commas for readability */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toFixed(0);
}

/** Format a dollar amount */
export function formatCost(cost: number): string {
  if (cost >= 100) {
    return `$${cost.toFixed(0)}`;
  }
  if (cost >= 1) {
    return `$${cost.toFixed(2)}`;
  }
  return `$${cost.toFixed(4)}`;
}

/** Format a percentage (0-1 range) */
export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
