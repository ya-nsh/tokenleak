import { useRef, useCallback, useEffect } from 'react';
import type { TabSelectRenderable, TabSelectOption } from '@opentui/core';
import type { TimeRange, MetricTab } from '@tokenleak/renderers';
import { TIME_RANGES, METRIC_TABS } from '@tokenleak/renderers';
import { THEME } from '../theme.js';

export type TabBarProps = {
  activeRange: TimeRange;
  activeTab: MetricTab;
  onRangeChange: (range: TimeRange) => void;
  onTabChange: (tab: MetricTab) => void;
};

const RANGE_OPTIONS: TabSelectOption[] = TIME_RANGES.map((r) => ({
  name: r,
  description: '',
}));

const TAB_OPTIONS: TabSelectOption[] = METRIC_TABS.map((t) => ({
  name: t,
  description: '',
}));

export function TabBar({ activeRange, activeTab, onRangeChange, onTabChange }: TabBarProps) {
  const rangeIndex = TIME_RANGES.indexOf(activeRange);
  const tabIndex = METRIC_TABS.indexOf(activeTab);
  const rangeRef = useRef<TabSelectRenderable>(null);
  const tabRef = useRef<TabSelectRenderable>(null);

  useEffect(() => {
    rangeRef.current?.setSelectedIndex(rangeIndex);
  }, [rangeIndex]);

  useEffect(() => {
    tabRef.current?.setSelectedIndex(tabIndex);
  }, [tabIndex]);

  const handleRangeChange = useCallback(
    (index: number) => {
      const range = TIME_RANGES[index];
      if (range) onRangeChange(range);
    },
    [onRangeChange],
  );

  const handleTabChange = useCallback(
    (index: number) => {
      const tab = METRIC_TABS[index];
      if (tab) onTabChange(tab);
    },
    [onTabChange],
  );

  return (
    <box flexDirection="row" width="100%" gap={1}>
      <tab-select
        ref={rangeRef}
        options={RANGE_OPTIONS}
        tabWidth={6}
        selectedBackgroundColor={THEME.ACTIVE}
        selectedTextColor={THEME.BOLD_FG}
        textColor={THEME.DIM}
        showDescription={false}
        showUnderline={false}
        wrapSelection={true}
        onChange={handleRangeChange}
      />
      <text content=" | " fg={THEME.DIM} />
      <tab-select
        ref={tabRef}
        options={TAB_OPTIONS}
        tabWidth={10}
        selectedBackgroundColor={THEME.ACTIVE}
        selectedTextColor={THEME.BOLD_FG}
        textColor={THEME.DIM}
        showDescription={false}
        showUnderline={false}
        wrapSelection={true}
        onChange={handleTabChange}
      />
    </box>
  );
}
