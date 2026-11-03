import type { DailyUsage, ProviderData, UsageEvent } from '@tokenleak/core';
import { shiftDateStringLocal } from '@tokenleak/core';
import type { CursorSetupStatus } from '@tokenleak/registry';
import { buildTuiData } from '../data';
import type { TuiData } from '../data';

export const READY_CURSOR_STATUS: CursorSetupStatus = { state: 'ready', hasCredentials: false, hasCache: false };

const PROMPTS = [
  'fix the failing lint step in the build',
  'fix the lint errors in the build step',
  'add tests for the billing edge cases',
  'refactor the auth middleware',
];

/** Deterministic events for `days` days ending on `today`, across two models and sessions. */
export function makeEvents(provider: string, today: string, days: number): UsageEvent[] {
  const events: UsageEvent[] = [];
  for (let day = 0; day < days; day++) {
    const date = shiftDateStringLocal(today, -day);
    for (let i = 0; i < 4; i++) {
      const input = 1_000 + day * 10 + i;
      const output = 400 + i * 50;
      events.push({
        provider,
        timestamp: `${date}T${String(9 + i * 2).padStart(2, '0')}:15:00.000Z`,
        date,
        model: i % 2 === 0 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5',
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: 2_000,
        cacheWriteTokens: 100,
        totalTokens: input + output + 2_100,
        cost: (i % 2 === 0 ? 0.05 : 0.01) * (1 + day / 10),
        sessionId: `${provider}-${date}-${i < 2 ? 'a' : 'b'}`,
        projectId: 'project-alpha',
        prompt: PROMPTS[i],
        promptId: `user:${day}:${i}`,
      });
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function dailyFromEvents(events: UsageEvent[]): DailyUsage[] {
  const byDate = new Map<string, DailyUsage>();
  for (const event of events) {
    let day = byDate.get(event.date);
    if (!day) {
      day = { date: event.date, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0, models: [] };
      byDate.set(event.date, day);
    }
    let model = day.models.find((entry) => entry.model === event.model);
    if (!model) {
      model = { model: event.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0 };
      day.models.push(model);
    }
    for (const target of [day, model]) {
      target.inputTokens += event.inputTokens;
      target.outputTokens += event.outputTokens;
      target.cacheReadTokens += event.cacheReadTokens;
      target.cacheWriteTokens += event.cacheWriteTokens;
      target.totalTokens += event.totalTokens;
      target.cost += event.cost;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function makeProvider(provider: string, displayName: string, events: UsageEvent[]): ProviderData {
  const daily = dailyFromEvents(events);
  return {
    provider,
    displayName,
    daily,
    totalTokens: daily.reduce((sum, day) => sum + day.totalTokens, 0),
    totalCost: daily.reduce((sum, day) => sum + day.cost, 0),
    colors: { primary: '#d97706', secondary: '#fbbf24', gradient: ['#d97706', '#fbbf24'] },
    events,
  };
}

/** Two providers with 12 days of usage ending on `today`. */
export function makeTuiData(today: string): TuiData {
  return buildTuiData(
    [
      makeProvider('claude-code', 'Claude Code', makeEvents('claude-code', today, 12)),
      makeProvider('codex', 'Codex', makeEvents('codex', today, 5)),
    ],
    READY_CURSOR_STATUS,
    today,
  );
}
