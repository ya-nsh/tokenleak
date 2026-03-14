import { bold, bold256, dim, inverse256 } from '../colors';
import { truncateVisible } from '../layout';

export type TimeRange = '7d' | '30d' | '90d' | '365d';
export type MetricTab = 'overview' | 'delta' | 'provider' | 'sess' | 'tok' | 'model' | 'cwd' | 'dow' | 'tod';

export const TIME_RANGES: TimeRange[] = ['7d', '30d', '90d', '365d'];
export const METRIC_TABS: MetricTab[] = ['overview', 'delta', 'provider', 'sess', 'tok', 'model', 'cwd', 'dow', 'tod'];

const TAB_LABELS: Record<MetricTab, string> = {
  overview: 'overview',
  delta: 'delta',
  provider: 'provider',
  sess: 'sess',
  tok: 'tok',
  model: 'model',
  cwd: 'cwd',
  dow: 'dow',
  tod: 'tod',
};

const ACTIVE_COLOR = 33;  // blue
const HINT_COLOR = 220;   // gold

export function renderTabBar(
  activeRange: TimeRange,
  activeTab: MetricTab,
  width: number,
  noColor: boolean,
): string {
  const rangeParts = TIME_RANGES.map((r) => {
    if (r === activeRange) {
      return inverse256(` ${r} `, ACTIVE_COLOR, noColor);
    }
    return dim(` ${r} `, noColor);
  });

  const tabParts = METRIC_TABS.map((t) => {
    if (t === activeTab) {
      return inverse256(` ${TAB_LABELS[t]} `, ACTIVE_COLOR, noColor);
    }
    return dim(` ${TAB_LABELS[t]} `, noColor);
  });

  const separator = dim(' │ ', noColor);
  const rangeLine = `  ${rangeParts.join(' ')}${separator}${tabParts.join(' ')}`;

  const hints = [
    `${bold256('←/→', HINT_COLOR, noColor)} range`,
    `${bold256('tab', HINT_COLOR, noColor)} metric`,
    `${bold256('1-9', HINT_COLOR, noColor)} jump`,
    `${bold256('↑/↓', HINT_COLOR, noColor)} scroll`,
    `${bold256('q', HINT_COLOR, noColor)} close`,
  ];
  const hintLine = `  ${hints.join(dim('  ·  ', noColor))}`;

  return [
    truncateVisible(rangeLine, width),
    truncateVisible(hintLine, width),
  ].join('\n');
}
