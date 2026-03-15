import { useState, useCallback, useEffect, useMemo } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import type { TokenleakOutput, RenderOptions, DateRange } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import {
  renderTabBar,
  renderOverviewView,
  renderCompareView,
  renderProviderView,
  renderDowView,
  renderTodView,
  renderSessionView,
  renderModelView,
  renderTokenView,
  renderCwdView,
  renderContribGraph,
  TIME_RANGES,
  METRIC_TABS,
} from '@tokenleak/renderers';
import type { TimeRange, MetricTab } from '@tokenleak/renderers';
import type { TabbedDashboardOptions } from '../menu/types.js';
import { useAsyncData } from '../hooks/use-async-data.js';
import { useAutoRefresh } from '../hooks/use-auto-refresh.js';
import { useLayoutMode } from '../hooks/use-layout-mode.js';
import { AnsiText, getScrollInfo } from '../components/ansi-text.js';
import { TabBar } from '../components/tab-bar.js';
import { StatusBar } from '../components/status-bar.js';
import { THEME } from '../theme.js';

export type DashboardProps = {
  providers: IProvider[];
  options: TabbedDashboardOptions;
  loadData: (providers: IProvider[], range: DateRange, compare: string | null) => Promise<TokenleakOutput>;
  onExit: () => void;
};

function timeRangeToDays(range: TimeRange): number {
  switch (range) {
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    case '365d': return 365;
    default: return 30;
  }
}

function computeRange(range: TimeRange, baseUntil: string): DateRange {
  const d = new Date(baseUntil);
  d.setDate(d.getDate() - timeRangeToDays(range));
  const since = d.toISOString().slice(0, 10);
  return { since, until: baseUntil };
}

function renderActiveView(
  output: TokenleakOutput,
  tab: MetricTab,
  width: number,
  noColor: boolean,
  noInsights: boolean,
): string {
  const options: RenderOptions = {
    format: 'terminal',
    theme: 'dark',
    width,
    showInsights: !noInsights,
    noColor,
    output: null,
    more: true,
  };

  switch (tab) {
    case 'overview': return renderOverviewView(output, options);
    case 'delta': return renderCompareView(output, width, noColor);
    case 'provider': return renderProviderView(output, width, noColor);
    case 'sess': return renderSessionView(output, width, noColor);
    case 'tok': return renderTokenView(output, width, noColor);
    case 'model': return renderModelView(output, width, noColor);
    case 'cwd': return renderCwdView(output, width, noColor);
    case 'dow': return renderDowView(output, width, noColor);
    case 'tod': return renderTodView(output, width, noColor);
    case 'contrib': return renderContribGraph(output, width, noColor);
    default: return renderOverviewView(output, options);
  }
}

export function Dashboard({ providers, options, loadData, onExit }: DashboardProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(options.initialTimeRange ?? '30d');
  const [metricTab, setMetricTab] = useState<MetricTab>('overview');
  const [currentOutput, setCurrentOutput] = useState<TokenleakOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrollInfo, setScrollInfo] = useState<string | null>(null);
  const { width, height } = useLayoutMode();

  const baseUntil = options.until ?? new Date().toISOString().slice(0, 10);
  const compare = options.compare ?? 'auto';
  const noColor = options.noColor;
  const noInsights = options.noInsights ?? false;

  const resolveRange = useCallback(
    (range: TimeRange): DateRange => {
      if (options.initialRange && range === (options.initialTimeRange ?? '30d')) {
        return options.initialRange;
      }
      return computeRange(range, baseUntil);
    },
    [options.initialRange, options.initialTimeRange, baseUntil],
  );

  const dataCache = useAsyncData<TimeRange, TokenleakOutput>(
    async (key: TimeRange) => {
      const range = resolveRange(key);
      return loadData(providers, range, compare);
    },
    120_000,
  );

  const loadAndRender = useCallback(
    async (range: TimeRange) => {
      setLoading(true);
      try {
        const output = await dataCache.load(range);
        setCurrentOutput(output);
      } finally {
        setLoading(false);
      }
    },
    [dataCache],
  );

  useEffect(() => {
    void loadAndRender(timeRange);
  }, [timeRange]);

  const autoRefresh = useAutoRefresh(
    () => {
      dataCache.invalidate(timeRange);
      void loadAndRender(timeRange);
    },
    60,
  );

  const renderWidth = useMemo(() => {
    const termWidth = Math.max(40, width - 1);
    if (options.width === undefined || options.width === null) return termWidth;
    return Math.max(40, Math.min(termWidth, options.width));
  }, [width, options.width]);

  const headerHeight = 4;
  const footerHeight = 2;
  const viewportHeight = Math.max(4, height - headerHeight - footerHeight);

  const content = useMemo(() => {
    if (!currentOutput) return '';
    return renderActiveView(currentOutput, metricTab, renderWidth, noColor, noInsights);
  }, [currentOutput, metricTab, renderWidth, noColor, noInsights]);

  const dateLabel = currentOutput
    ? `${currentOutput.dateRange.since} → ${currentOutput.dateRange.until}`
    : '';

  useKeyboard((event: KeyEvent) => {
    if (event.name === 'q' || event.name === 'escape') {
      onExit();
      event.preventDefault();
      return;
    }
    if (event.ctrl && event.name === 'c') {
      onExit();
      event.preventDefault();
      return;
    }

    // Range switching
    if (event.name === 'left') {
      const idx = TIME_RANGES.indexOf(timeRange);
      const newIdx = (idx - 1 + TIME_RANGES.length) % TIME_RANGES.length;
      setTimeRange(TIME_RANGES[newIdx]!);
      event.preventDefault();
      return;
    }
    if (event.name === 'right') {
      const idx = TIME_RANGES.indexOf(timeRange);
      const newIdx = (idx + 1) % TIME_RANGES.length;
      setTimeRange(TIME_RANGES[newIdx]!);
      event.preventDefault();
      return;
    }

    // Tab cycling
    if (event.name === 'tab') {
      const idx = METRIC_TABS.indexOf(metricTab);
      const newIdx = event.shift
        ? (idx - 1 + METRIC_TABS.length) % METRIC_TABS.length
        : (idx + 1) % METRIC_TABS.length;
      setMetricTab(METRIC_TABS[newIdx]!);
      event.preventDefault();
      return;
    }

    // Number keys for tab jump
    const digit = event.sequence?.match?.(/^[1-9]$/)?.[0];
    if (digit) {
      const tabIdx = Number(digit) - 1;
      if (tabIdx < METRIC_TABS.length) {
        setMetricTab(METRIC_TABS[tabIdx]!);
        event.preventDefault();
      }
      return;
    }

    // Auto-refresh toggle
    if (event.name === 'r') {
      autoRefresh.toggle();
      event.preventDefault();
      return;
    }
  });

  const hints = ['←/→ range', 'tab metric', '1-9 jump', '↑/↓ scroll', 'r refresh', 'q close'];

  return (
    <box flexDirection="column" width="100%" height="100%">
      <TabBar
        activeRange={timeRange}
        activeTab={metricTab}
        onRangeChange={setTimeRange}
        onTabChange={setMetricTab}
      />
      {dateLabel && <text content={`  ${dateLabel}`} fg={THEME.DIM} />}
      <box height={1} />
      <box flexGrow={1}>
        {loading ? (
          <text content="  Loading data..." fg={THEME.WARNING} />
        ) : (
          <AnsiText
            content={content}
            focused={true}
            viewportHeight={viewportHeight}
            onScrollChange={(offset, total, vp) => setScrollInfo(getScrollInfo(offset, total, vp))}
          />
        )}
      </box>
      <StatusBar
        hints={hints}
        scrollInfo={scrollInfo}
        refreshCountdown={autoRefresh.enabled ? autoRefresh.secondsUntilRefresh : null}
      />
    </box>
  );
}
