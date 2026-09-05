import { sessionKey } from './session-identity';
import { existsSync } from 'node:fs';
import { dirname, basename, relative } from 'node:path';
import { join } from 'node:path';
import type {
  AttributionCluster,
  AttributionTaskStyle,
  AttributionWindow,
  DailyUsage,
  ProjectDrilldownEntry,
  SessionDrilldownEntry,
  TopModelEntry,
  UsageEvent,
} from '../types';
import { calculateStreaks } from './streaks';

interface SessionAccumulator {
  sessionId: string;
  label: string;
  provider: string;
  projectId: string | null;
  repoRoot: string | null;
  directory: string | null;
  start: string;
  end: string;
  durationMs: number | null;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  modelTokens: Map<string, { tokens: number; cost: number }>;
  activeDates: Set<string>;
}

interface AttributionClusterAccumulator {
  clusterId: string;
  label: string;
  taskStyle: AttributionTaskStyle;
  repoRoot: string | null;
  directory: string | null;
  tokens: number;
  cost: number;
  sessions: SessionDrilldownEntry[];
  activeDates: Set<string>;
  providerTokens: Map<string, number>;
  modelTokens: Map<string, number>;
}

interface AttributionScope {
  key: string;
  labelBase: string;
  repoRoot: string | null;
  directory: string | null;
}

const ATTRIBUTION_WINDOW_GAP_MS = 6 * 60 * 60 * 1000;

function isAbsoluteProjectPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/');
}

export function inferRepoRoot(projectId?: string | null): string | null {
  if (!projectId || !projectId.trim()) {
    return null;
  }

  const normalized = normalizePathLike(projectId.trim());
  if (!isAbsoluteProjectPath(normalized)) {
    return normalized;
  }

  let current = normalized;
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) {
    return normalized;
  }

  if (normalized.startsWith('/Users/') && parts.length >= 3) {
    return `/${parts.slice(0, 3).join('/')}`;
  }

  if (normalized.startsWith('/home/') && parts.length >= 3) {
    return `/${parts.slice(0, 3).join('/')}`;
  }

  if (/^[A-Za-z]:\//.test(normalized) && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }

  return dirname(normalized);
}

/** Reuse filesystem discovery within one calculation; refreshes see new repositories. */
function createRepoRootResolver(): typeof inferRepoRoot {
  const roots = new Map<string | null | undefined, string | null>();
  return (projectId) => {
    if (roots.has(projectId)) return roots.get(projectId)!;
    const root = inferRepoRoot(projectId);
    roots.set(projectId, root);
    return root;
  };
}

export function inferDirectoryLabel(
  projectId?: string | null,
  repoRoot?: string | null,
): string | null {
  if (!projectId || !projectId.trim()) {
    return null;
  }

  const normalized = normalizePathLike(projectId.trim());
  if (!repoRoot || !isAbsoluteProjectPath(normalized)) {
    return basename(normalized) || normalized;
  }

  const rel = normalizePathLike(relative(repoRoot, normalized));
  if (!rel || rel === '' || rel === '.') {
    return '.';
  }

  const [first] = rel.split('/').filter(Boolean);
  return first ?? '.';
}

function topModelEntries(
  modelTokens: Map<string, { tokens: number; cost: number }>,
  totalTokens: number,
  limit: number,
): TopModelEntry[] {
  return [...modelTokens.entries()]
    .map(([model, value]) => ({
      model,
      tokens: value.tokens,
      cost: value.cost,
      percentage: totalTokens > 0 ? value.tokens / totalTokens : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit);
}

function topNames(tokensByName: Map<string, number>, limit: number): string[] {
  return [...tokensByName.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

function humanizeTaskStyle(taskStyle: AttributionTaskStyle): string {
  return taskStyle.replace(/-/g, ' ');
}

function parseIsoTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferAttributionTaskStyle(session: SessionDrilldownEntry): AttributionTaskStyle {
  const durationMs = session.durationMs ?? 0;

  if (
    durationMs > 0 &&
    durationMs <= 10 * 60 * 1000 &&
    session.eventCount <= 2 &&
    session.totalTokens < 6_000
  ) {
    return 'quick-hit';
  }

  if (
    durationMs >= 45 * 60 * 1000 ||
    session.eventCount >= 5 ||
    session.totalTokens >= 20_000
  ) {
    return 'deep-work';
  }

  if (
    durationMs >= 15 * 60 * 1000 ||
    session.eventCount >= 3 ||
    session.totalTokens >= 6_000
  ) {
    return 'iterative';
  }

  return 'mixed';
}

function resolveAttributionScope(session: SessionDrilldownEntry): AttributionScope {
  const hasStablePath =
    (session.projectId ? isAbsoluteProjectPath(normalizePathLike(session.projectId)) : false) ||
    (session.repoRoot ? isAbsoluteProjectPath(normalizePathLike(session.repoRoot)) : false);

  if (hasStablePath && session.repoRoot && session.directory) {
    const labelBase = session.directory === '.' ? basename(session.repoRoot) : session.directory;
    return {
      key: `repo:${session.repoRoot}::dir:${session.directory}`,
      labelBase,
      repoRoot: session.repoRoot,
      directory: session.directory,
    };
  }

  if (session.projectId) {
    return {
      key: `project:${session.provider}:${session.projectId}`,
      labelBase: session.directory ?? session.projectId,
      repoRoot: hasStablePath ? session.repoRoot : null,
      directory: hasStablePath ? session.directory : null,
    };
  }

  return {
    key: `session:${session.provider}:${session.sessionId}`,
    labelBase: session.directory ?? session.label,
    repoRoot: session.repoRoot,
    directory: session.directory,
  };
}

function buildAttributionWindows(sessions: SessionDrilldownEntry[]): AttributionWindow[] {
  if (sessions.length === 0) {
    return [];
  }

  const ordered = sessions
    .slice()
    .sort((a, b) => {
      const aTime = parseIsoTime(a.start);
      const bTime = parseIsoTime(b.start);
      if (aTime === null && bTime === null) {
        return a.start.localeCompare(b.start);
      }
      if (aTime === null) {
        return 1;
      }
      if (bTime === null) {
        return -1;
      }
      return aTime - bTime;
    });

  const windows: AttributionWindow[] = [];

  for (const session of ordered) {
    const startMs = parseIsoTime(session.start);
    const endMs = parseIsoTime(session.end) ?? startMs;
    const lastWindow = windows.at(-1);

    if (
      lastWindow &&
      startMs !== null &&
      endMs !== null &&
      parseIsoTime(lastWindow.end) !== null &&
      startMs <= (parseIsoTime(lastWindow.end) ?? startMs) + ATTRIBUTION_WINDOW_GAP_MS
    ) {
      if ((parseIsoTime(lastWindow.end) ?? endMs) < endMs) {
        lastWindow.end = session.end;
      }
      lastWindow.sessionCount += 1;
      continue;
    }

    windows.push({
      start: session.start,
      end: session.end,
      sessionCount: 1,
    });
  }

  return windows;
}

export function buildSessionRollups(events: UsageEvent[], topModelLimit: number = 3): SessionDrilldownEntry[] {
  const resolveRepoRoot = createRepoRootResolver();
  const sessions = new Map<string, SessionAccumulator>();

  for (const event of events) {
    const sessionId = event.sessionId?.trim() || `${event.provider}:${event.timestamp}`;
    const projectId = event.projectId?.trim() || null;
    const repoRoot = event.repoRoot ?? resolveRepoRoot(projectId);
    const directory = event.directory ?? inferDirectoryLabel(projectId, repoRoot);
    const label = projectId ?? sessionId;

    let session = sessions.get(sessionKey(event.provider, sessionId));
    if (!session) {
      session = {
        sessionId,
        label,
        provider: event.provider,
        projectId,
        repoRoot,
        directory,
        start: event.timestamp,
        end: event.timestamp,
        durationMs: null,
        eventCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: 0,
        modelTokens: new Map(),
        activeDates: new Set(),
      };
      sessions.set(sessionKey(event.provider, sessionId), session);
    } else {
      if (!session.projectId && projectId) {
        session.projectId = projectId;
        session.label = projectId;
      }
      if (!session.repoRoot && repoRoot) {
        session.repoRoot = repoRoot;
      }
      if (!session.directory && directory) {
        session.directory = directory;
      }
    }

    session.start = session.start < event.timestamp ? session.start : event.timestamp;
    session.end = session.end > event.timestamp ? session.end : event.timestamp;
    session.eventCount += 1;
    session.inputTokens += event.inputTokens;
    session.outputTokens += event.outputTokens;
    session.cacheReadTokens += event.cacheReadTokens;
    session.cacheWriteTokens += event.cacheWriteTokens;
    session.totalTokens += event.totalTokens;
    session.cost += event.cost;
    session.activeDates.add(event.date);

    const existingModel = session.modelTokens.get(event.model) ?? { tokens: 0, cost: 0 };
    existingModel.tokens += event.totalTokens;
    existingModel.cost += event.cost;
    session.modelTokens.set(event.model, existingModel);

    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) && event.durationMs > 0) {
      session.durationMs = (session.durationMs ?? 0) + event.durationMs;
    }
  }

  return [...sessions.values()]
    .map((session) => {
      let durationMs = session.durationMs;
      if (durationMs === null) {
        const startMs = Date.parse(session.start);
        const endMs = Date.parse(session.end);
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
          durationMs = endMs - startMs;
        }
      }

      return {
        sessionId: session.sessionId,
        label: session.label,
        provider: session.provider,
        projectId: session.projectId,
        repoRoot: session.repoRoot,
        directory: session.directory,
        start: session.start,
        end: session.end,
        durationMs,
        eventCount: session.eventCount,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheWriteTokens: session.cacheWriteTokens,
        totalTokens: session.totalTokens,
        cost: session.cost,
        topModels: topModelEntries(session.modelTokens, session.totalTokens, topModelLimit),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

export function buildProjectRollups(
  events: UsageEvent[],
  topModelLimit: number = 5,
  topSessionLimit: number = 3,
): ProjectDrilldownEntry[] {
  const sessions = buildSessionRollups(events, topModelLimit);
  const resolveRepoRoot = createRepoRootResolver();
  const byProject = new Map<string, {
    projectId: string;
    repoRoot: string | null;
    directory: string | null;
    sessionCount: number;
    activeDates: Set<string>;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    cost: number;
    modelTokens: Map<string, { tokens: number; cost: number }>;
    topSessions: SessionDrilldownEntry[];
  }>();

  for (const event of events) {
    const projectId = event.projectId?.trim();
    if (!projectId) {
      continue;
    }

    const repoRoot = event.repoRoot ?? resolveRepoRoot(projectId);
    const directory = event.directory ?? inferDirectoryLabel(projectId, repoRoot);
    let project = byProject.get(projectId);
    if (!project) {
      project = {
        projectId,
        repoRoot,
        directory,
        sessionCount: 0,
        activeDates: new Set(),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: 0,
        modelTokens: new Map(),
        topSessions: [],
      };
      byProject.set(projectId, project);
    }

    project.activeDates.add(event.date);
    project.inputTokens += event.inputTokens;
    project.outputTokens += event.outputTokens;
    project.cacheReadTokens += event.cacheReadTokens;
    project.cacheWriteTokens += event.cacheWriteTokens;
    project.totalTokens += event.totalTokens;
    project.cost += event.cost;

    const existingModel = project.modelTokens.get(event.model) ?? { tokens: 0, cost: 0 };
    existingModel.tokens += event.totalTokens;
    existingModel.cost += event.cost;
    project.modelTokens.set(event.model, existingModel);
  }

  for (const session of sessions) {
    if (!session.projectId) {
      continue;
    }

    const project = byProject.get(session.projectId);
    if (!project) {
      continue;
    }

    project.sessionCount += 1;
    project.topSessions.push(session);
  }

  return [...byProject.values()]
    .map((project) => {
      const streakDaily: DailyUsage[] = [...project.activeDates]
        .sort()
        .map((date) => ({
          date,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          cost: 0,
          models: [],
        }));
      const streak = calculateStreaks(
        streakDaily,
        streakDaily[streakDaily.length - 1]?.date ?? '1970-01-01',
      ).longest;
      return {
        projectId: project.projectId,
        repoRoot: project.repoRoot,
        directory: project.directory,
        sessionCount: project.sessionCount,
        activeDays: project.activeDates.size,
        streak,
        inputTokens: project.inputTokens,
        outputTokens: project.outputTokens,
        cacheReadTokens: project.cacheReadTokens,
        cacheWriteTokens: project.cacheWriteTokens,
        totalTokens: project.totalTokens,
        cost: project.cost,
        topModels: topModelEntries(project.modelTokens, project.totalTokens, topModelLimit),
        topSessions: project.topSessions
          .sort((a, b) => b.totalTokens - a.totalTokens)
          .slice(0, topSessionLimit)
          .map((session) => ({
            label: session.label,
            tokens: session.totalTokens,
            cost: session.cost,
            count: session.eventCount,
            durationMs: session.durationMs,
          })),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

export function buildAttributionClusters(
  events: UsageEvent[],
  modelLimit: number = 5,
  providerLimit: number = 4,
): AttributionCluster[] {
  const sessions = buildSessionRollups(events, modelLimit);
  const clusters = new Map<string, AttributionClusterAccumulator>();
  const clusterBySessionId = new Map<string, string>();

  for (const session of sessions) {
    const taskStyle = inferAttributionTaskStyle(session);
    const scope = resolveAttributionScope(session);
    const clusterId = `${scope.key}::style:${taskStyle}`;
    clusterBySessionId.set(sessionKey(session.provider, session.sessionId), clusterId);

    let cluster = clusters.get(clusterId);
    if (!cluster) {
      cluster = {
        clusterId,
        label: `${scope.labelBase} · ${humanizeTaskStyle(taskStyle)}`,
        taskStyle,
        repoRoot: scope.repoRoot,
        directory: scope.directory,
        tokens: 0,
        cost: 0,
        sessions: [],
        activeDates: new Set(),
        providerTokens: new Map(),
        modelTokens: new Map(),
      };
      clusters.set(clusterId, cluster);
    }

    cluster.sessions.push(session);
  }

  for (const event of events) {
    const sessionId = event.sessionId?.trim() || `${event.provider}:${event.timestamp}`;
    const clusterId = clusterBySessionId.get(sessionKey(event.provider, sessionId));
    if (!clusterId) {
      continue;
    }

    const cluster = clusters.get(clusterId);
    if (!cluster) {
      continue;
    }

    cluster.tokens += event.totalTokens;
    cluster.cost += event.cost;
    cluster.activeDates.add(event.date);
    cluster.providerTokens.set(
      event.provider,
      (cluster.providerTokens.get(event.provider) ?? 0) + event.totalTokens,
    );
    cluster.modelTokens.set(
      event.model,
      (cluster.modelTokens.get(event.model) ?? 0) + event.totalTokens,
    );
  }

  return [...clusters.values()]
    .map((cluster) => ({
      clusterId: cluster.clusterId,
      label: cluster.label,
      taskStyle: cluster.taskStyle,
      repoRoot: cluster.repoRoot,
      directory: cluster.directory,
      sessionCount: cluster.sessions.length,
      activeDays: cluster.activeDates.size,
      tokens: cluster.tokens,
      cost: cluster.cost,
      providers: topNames(cluster.providerTokens, providerLimit),
      models: topNames(cluster.modelTokens, modelLimit),
      timeWindows: buildAttributionWindows(cluster.sessions),
    }))
    .sort((a, b) => b.tokens - a.tokens || b.sessionCount - a.sessionCount);
}

export function normalizeScores(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return values.map(() => 1);
  }

  return values.map((value) => (value - min) / (max - min));
}
