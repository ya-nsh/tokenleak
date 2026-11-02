import { formatTokenCount } from '../format';
import type { FocusEntry, FocusReport, UsageEvent } from '../types';
import { buildProjectRollups, buildSessionRollups, describeProject, normalizeScores } from './analytics';
import { sessionKey } from './session-identity';

const FOCUS_WEIGHTS = {
  duration: 0.45,
  density: 0.4,
  streak: 0.15,
} as const;

const MS_PER_HOUR = 3_600_000;
/** A pause longer than this is a break, not focused work. */
export const FOCUS_IDLE_GAP_MS = 30 * 60_000;
/** Shorter than this, tokens per hour is noise (one big turn reads as 400M/h). */
export const FOCUS_MIN_DENSITY_MS = 10 * 60_000;

function round(value: number, digits: number = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return 'no duration';
  }

  const totalMinutes = Math.round(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function formatTokensPerHour(tokensPerHour: number): string {
  return `${formatTokenCount(tokensPerHour)} tok/hr`;
}

/**
 * Time actually spent working in a session: the sum of gaps between
 * consecutive events, skipping gaps longer than FOCUS_IDLE_GAP_MS. A session
 * resumed across three days is three bursts, not 72 hours of focus.
 */
export function activeDurationMs(timestamps: readonly string[]): number {
  const times = timestamps
    .map((timestamp) => Date.parse(timestamp))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!;
    if (gap <= FOCUS_IDLE_GAP_MS) active += gap;
  }
  return active;
}

function normalizeFocusScores(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  if (values.every((value) => value === 0)) {
    return values.map(() => 0);
  }

  return normalizeScores(values);
}

function buildRationale(
  activeMs: number,
  streak: number,
  durationScore: number,
  densityScore: number,
  streakScore: number,
  tokensPerHour: number,
): string[] {
  const durationLine = durationScore >= 70
    ? `${formatDuration(activeMs)} of active work`
    : activeMs > 0
      ? `${formatDuration(activeMs)} active`
      : 'single burst with no measurable active time';

  const densityLine = densityScore >= 70
    ? `${formatTokensPerHour(tokensPerHour)} token density`
    : tokensPerHour > 0
      ? `${formatTokensPerHour(tokensPerHour)} kept the pace up`
      : 'too short for a density signal';

  const streakLine = streakScore >= 70
    ? `${streak}-day project streak`
    : streak > 1
      ? `${streak}-day streak support`
      : 'single-day project streak';

  return [durationLine, densityLine, streakLine];
}

export function buildFocusReport(events: UsageEvent[]): FocusReport {
  const sessions = buildSessionRollups(events);
  const timingBySession = new Map<string, { timestamps: string[]; reportedMs: number }>();
  for (const event of events) {
    const key = sessionKey(event.provider, event.sessionId?.trim() || `${event.provider}:${event.timestamp}`);
    const timing = timingBySession.get(key) ?? { timestamps: [], reportedMs: 0 };
    timing.timestamps.push(event.timestamp);
    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) && event.durationMs > 0) {
      timing.reportedMs += event.durationMs;
    }
    timingBySession.set(key, timing);
  }
  // Provider-reported turn durations are exact; otherwise estimate from event gaps.
  const activeMs = sessions.map((session) => {
    const timing = timingBySession.get(sessionKey(session.provider, session.sessionId));
    if (!timing) return 0;
    return timing.reportedMs > 0 ? timing.reportedMs : activeDurationMs(timing.timestamps);
  });
  const streakByProject = new Map(
    buildProjectRollups(events).map((project) => [project.projectId, project.streak] as const),
  );

  const durations = activeMs;
  const densityValues = sessions.map((session, index) => {
    const active = activeMs[index] ?? 0;
    return active >= FOCUS_MIN_DENSITY_MS ? session.totalTokens / (active / MS_PER_HOUR) : 0;
  });
  const streakValues = sessions.map((session) => (
    session.projectId ? (streakByProject.get(session.projectId) ?? 1) : 1
  ));

  const durationScores = normalizeFocusScores(durations).map((value) => round(value * 100, 1));
  const densityScores = normalizeFocusScores(densityValues).map((value) => round(value * 100, 1));
  const streakScores = normalizeFocusScores(streakValues).map((value) => round(value * 100, 1));

  const entries: FocusEntry[] = sessions
    .map((session, index) => {
      const streak = streakValues[index] ?? 1;
      const durationScore = durationScores[index] ?? 0;
      const densityScore = densityScores[index] ?? 0;
      const streakScore = streakScores[index] ?? 0;
      const tokensPerHour = densityValues[index] ?? 0;
      const score = round(
        durationScore * FOCUS_WEIGHTS.duration +
          densityScore * FOCUS_WEIGHTS.density +
          streakScore * FOCUS_WEIGHTS.streak,
        1,
      );

      return {
        sessionId: session.sessionId,
        label: describeProject(session.projectId, session.repoRoot) ?? session.label,
        provider: session.provider,
        projectId: session.projectId,
        repoRoot: session.repoRoot,
        start: session.start,
        end: session.end,
        durationMs: activeMs[index] ?? 0,
        spanMs: session.durationMs,
        tokensPerHour: round(tokensPerHour, 2),
        totalTokens: session.totalTokens,
        cost: round(session.cost, 4),
        ...(session.costCompleteness ? { costCompleteness: session.costCompleteness } : {}),
        streak,
        score,
        scoreBreakdown: {
          duration: durationScore,
          density: densityScore,
          streak: streakScore,
        },
        rationale: buildRationale(
          activeMs[index] ?? 0,
          streak,
          durationScore,
          densityScore,
          streakScore,
          tokensPerHour,
        ),
      };
    })
    .sort((left, right) => (
      right.score - left.score ||
      right.totalTokens - left.totalTokens ||
      (right.durationMs ?? 0) - (left.durationMs ?? 0) ||
      left.start.localeCompare(right.start)
    ));

  return {
    method:
      'Deep-work score = active time 45% + token density 40% + project streak 15%, normalized across selected sessions. Gaps over 30 minutes count as breaks; density needs 10+ active minutes.',
    entries,
  };
}
