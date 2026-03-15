import type {
  ProjectDrilldownEntry,
  SessionDrilldownEntry,
  TokenleakOutput,
} from '@tokenleak/core';

export interface DrilldownFilterState {
  query: string;
  provider: string;
  project: string;
  model: string;
  sort: string;
  active: boolean;
}

export const EMPTY_DRILLDOWN_FILTER_STATE: DrilldownFilterState = {
  query: '',
  provider: '',
  project: '',
  model: '',
  sort: '',
  active: false,
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function sortByText<T>(a: T, b: T, left: string, right: string): number {
  return left.localeCompare(right);
}

function compareNumbersDescending(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
  return (right ?? -1) - (left ?? -1);
}

function matchesNeedle(values: Array<string | null | undefined>, needle: string): boolean {
  if (!needle) {
    return true;
  }

  const normalizedNeedle = normalizeText(needle);
  return values.some((value) => normalizeText(value).includes(normalizedNeedle));
}

export function hasActiveDrilldownFilters(
  filterState: DrilldownFilterState | null | undefined,
): boolean {
  if (!filterState) {
    return false;
  }

  return (
    filterState.active ||
    Boolean(
      normalizeText(filterState.query) ||
      normalizeText(filterState.provider) ||
      normalizeText(filterState.project) ||
      normalizeText(filterState.model) ||
      normalizeText(filterState.sort),
    )
  );
}

export function formatDrilldownFilterSummary(
  filterState: DrilldownFilterState | null | undefined,
): string {
  if (!hasActiveDrilldownFilters(filterState)) {
    return '';
  }

  const parts: string[] = [];
  if (filterState?.query.trim()) parts.push(`query=${filterState.query.trim()}`);
  if (filterState?.provider.trim()) parts.push(`provider=${filterState.provider.trim()}`);
  if (filterState?.project.trim()) parts.push(`project=${filterState.project.trim()}`);
  if (filterState?.model.trim()) parts.push(`model=${filterState.model.trim()}`);
  if (filterState?.sort.trim()) parts.push(`sort=${filterState.sort.trim()}`);
  return parts.join('  ');
}

function sortSessions(
  sessions: SessionDrilldownEntry[],
  sort: string,
): SessionDrilldownEntry[] {
  const normalizedSort = normalizeText(sort);
  const sorted = sessions.slice();

  sorted.sort((left, right) => {
    switch (normalizedSort) {
      case 'cost':
        return compareNumbersDescending(left.cost, right.cost)
          || compareNumbersDescending(left.totalTokens, right.totalTokens)
          || sortByText(left, right, left.label, right.label);
      case 'duration':
        return compareNumbersDescending(left.durationMs, right.durationMs)
          || compareNumbersDescending(left.totalTokens, right.totalTokens)
          || sortByText(left, right, left.label, right.label);
      case 'events':
        return compareNumbersDescending(left.eventCount, right.eventCount)
          || compareNumbersDescending(left.totalTokens, right.totalTokens)
          || sortByText(left, right, left.label, right.label);
      case 'start':
        return right.start.localeCompare(left.start)
          || compareNumbersDescending(left.totalTokens, right.totalTokens)
          || sortByText(left, right, left.label, right.label);
      case 'tokens':
      default:
        return compareNumbersDescending(left.totalTokens, right.totalTokens)
          || compareNumbersDescending(left.cost, right.cost)
          || sortByText(left, right, left.label, right.label);
    }
  });

  return sorted;
}

function sortProjects(
  projects: ProjectDrilldownEntry[],
  sort: string,
): ProjectDrilldownEntry[] {
  const normalizedSort = normalizeText(sort);
  const sorted = projects.slice();

  sorted.sort((left, right) => {
    switch (normalizedSort) {
      case 'cost':
        return compareNumbersDescending(left.cost, right.cost)
          || compareNumbersDescending(left.totalTokens, right.totalTokens)
          || sortByText(left, right, left.projectId, right.projectId);
      case 'sessions':
        return compareNumbersDescending(left.sessionCount, right.sessionCount)
          || compareNumbersDescending(left.totalTokens, right.totalTokens)
          || sortByText(left, right, left.projectId, right.projectId);
      case 'streak':
        return compareNumbersDescending(left.streak, right.streak)
          || compareNumbersDescending(left.totalTokens, right.totalTokens)
          || sortByText(left, right, left.projectId, right.projectId);
      case 'active-days':
        return compareNumbersDescending(left.activeDays, right.activeDays)
          || compareNumbersDescending(left.totalTokens, right.totalTokens)
          || sortByText(left, right, left.projectId, right.projectId);
      case 'tokens':
      default:
        return compareNumbersDescending(left.totalTokens, right.totalTokens)
          || compareNumbersDescending(left.cost, right.cost)
          || sortByText(left, right, left.projectId, right.projectId);
    }
  });

  return sorted;
}

function buildProjectProviderIndex(
  output: TokenleakOutput,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const sessions = output.more?.sessionDrilldown ?? [];

  for (const session of sessions) {
    if (!session.projectId) {
      continue;
    }

    const providers = index.get(session.projectId) ?? new Set<string>();
    providers.add(session.provider);
    index.set(session.projectId, providers);
  }

  return index;
}

export function getFilteredSessions(
  output: TokenleakOutput,
  filterState: DrilldownFilterState | null | undefined,
): {
  total: number;
  filtered: SessionDrilldownEntry[];
} {
  const sessions = output.more?.sessionDrilldown ?? [];
  if (sessions.length === 0) {
    return { total: 0, filtered: [] };
  }

  const filter = filterState ?? EMPTY_DRILLDOWN_FILTER_STATE;
  const filtered = sessions.filter((session) => {
    if (!matchesNeedle([session.provider], filter.provider)) {
      return false;
    }

    if (!matchesNeedle([
      session.label,
      session.projectId,
      session.repoRoot,
      session.directory,
    ], filter.project)) {
      return false;
    }

    if (!matchesNeedle(session.topModels.map((model) => model.model), filter.model)) {
      return false;
    }

    if (!matchesNeedle([
      session.label,
      session.sessionId,
      session.provider,
      session.projectId,
      session.repoRoot,
      session.directory,
      ...session.topModels.map((model) => model.model),
    ], filter.query)) {
      return false;
    }

    return true;
  });

  return {
    total: sessions.length,
    filtered: sortSessions(filtered, filter.sort),
  };
}

export function getFilteredProjects(
  output: TokenleakOutput,
  filterState: DrilldownFilterState | null | undefined,
): {
  total: number;
  filtered: ProjectDrilldownEntry[];
} {
  const projects = output.more?.projectDrilldown ?? [];
  if (projects.length === 0) {
    return { total: 0, filtered: [] };
  }

  const filter = filterState ?? EMPTY_DRILLDOWN_FILTER_STATE;
  const providerIndex = buildProjectProviderIndex(output);
  const filtered = projects.filter((project) => {
    if (!matchesNeedle([
      ...Array.from(providerIndex.get(project.projectId) ?? []),
    ], filter.provider)) {
      return false;
    }

    if (!matchesNeedle([
      project.projectId,
      project.repoRoot,
      project.directory,
    ], filter.project)) {
      return false;
    }

    if (!matchesNeedle(project.topModels.map((model) => model.model), filter.model)) {
      return false;
    }

    if (!matchesNeedle([
      project.projectId,
      project.repoRoot,
      project.directory,
      ...project.topModels.map((model) => model.model),
      ...project.topSessions.map((session) => session.label),
      ...Array.from(providerIndex.get(project.projectId) ?? []),
    ], filter.query)) {
      return false;
    }

    return true;
  });

  return {
    total: projects.length,
    filtered: sortProjects(filtered, filter.sort),
  };
}
