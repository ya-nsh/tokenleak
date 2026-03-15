import { dirname, basename, relative } from 'node:path';
import type {
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

export function buildSessionRollups(events: UsageEvent[], topModelLimit: number = 3): SessionDrilldownEntry[] {
  const sessions = new Map<string, SessionAccumulator>();

  for (const event of events) {
    const sessionId = event.sessionId?.trim() || `${event.provider}:${event.timestamp}`;
    const projectId = event.projectId?.trim() || null;
    const repoRoot = event.repoRoot ?? inferRepoRoot(projectId);
    const directory = event.directory ?? inferDirectoryLabel(projectId, repoRoot);
    const label = projectId ?? sessionId;

    let session = sessions.get(sessionId);
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
      sessions.set(sessionId, session);
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

    const repoRoot = event.repoRoot ?? inferRepoRoot(projectId);
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
      const streak = calculateStreaks(streakDaily).longest;
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
