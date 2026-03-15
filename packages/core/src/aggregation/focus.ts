import type { FocusEntry, FocusReport, SessionDrilldownEntry, UsageEvent } from '../types';
import { buildProjectRollups, buildSessionRollups, normalizeScores } from './analytics';

const FOCUS_WEIGHTS = {
  duration: 0.45,
  density: 0.4,
  streak: 0.15,
} as const;

const MS_PER_HOUR = 3_600_000;

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
  return `${Math.round(tokensPerHour).toLocaleString('en-US')} tok/hr`;
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
  session: SessionDrilldownEntry,
  streak: number,
  durationScore: number,
  densityScore: number,
  streakScore: number,
  tokensPerHour: number,
): string[] {
  const durationLine = durationScore >= 70
    ? `${formatDuration(session.durationMs)} session window`
    : session.durationMs && session.durationMs > 0
      ? `${formatDuration(session.durationMs)} runtime kept it active`
      : 'single-event session with no duration signal';

  const densityLine = densityScore >= 70
    ? `${formatTokensPerHour(tokensPerHour)} token density`
    : tokensPerHour > 0
      ? `${formatTokensPerHour(tokensPerHour)} kept the pace up`
      : 'insufficient duration for a density signal';

  const streakLine = streakScore >= 70
    ? `${streak}-day project streak`
    : streak > 1
      ? `${streak}-day streak support`
      : 'single-day project streak';

  return [durationLine, densityLine, streakLine];
}

export function buildFocusReport(events: UsageEvent[]): FocusReport {
  const sessions = buildSessionRollups(events);
  const streakByProject = new Map(
    buildProjectRollups(events).map((project) => [project.projectId, project.streak] as const),
  );

  const durations = sessions.map((session) => Math.max(0, session.durationMs ?? 0));
  const densityValues = sessions.map((session) => (
    session.durationMs && session.durationMs > 0
      ? session.totalTokens / (session.durationMs / MS_PER_HOUR)
      : 0
  ));
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
        label: session.label,
        provider: session.provider,
        projectId: session.projectId,
        repoRoot: session.repoRoot,
        start: session.start,
        end: session.end,
        durationMs: session.durationMs,
        tokensPerHour: round(tokensPerHour, 2),
        totalTokens: session.totalTokens,
        cost: round(session.cost, 4),
        streak,
        score,
        scoreBreakdown: {
          duration: durationScore,
          density: densityScore,
          streak: streakScore,
        },
        rationale: buildRationale(
          session,
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
    method: 'Deep-work score = duration 45% + token density 40% + project streak 15%, normalized across selected sessions.',
    entries,
  };
}
