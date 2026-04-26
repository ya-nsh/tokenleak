import type {
  CommonsBucketEntry,
  CommonsExport,
  CommonsInspectReport,
  CommonsProviderModelEntry,
  TokenleakOutput,
} from '../types';

function bucketNumber(value: number, step: number): string {
  if (value <= 0) {
    return '0';
  }

  const lower = Math.floor(value / step) * step;
  const upper = lower + step - 1;
  return `${lower}-${upper}`;
}

function bucketCost(value: number): string {
  if (value <= 0) {
    return '$0';
  }

  const lower = Math.floor(value);
  const upper = lower + 1;
  return `$${lower}-$${upper}`;
}

function bucketRate(value: number): string {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  const lower = Math.floor(percent / 10) * 10;
  const upper = Math.min(100, lower + 9);
  return `${lower}-${upper}%`;
}

function incrementBucket(map: Map<string, number>, label: string): void {
  map.set(label, (map.get(label) ?? 0) + 1);
}

function mapToEntries(map: Map<string, number>): CommonsBucketEntry[] {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function providerModelEntries(output: TokenleakOutput): CommonsProviderModelEntry[] {
  const entries: CommonsProviderModelEntry[] = [];

  for (const provider of output.providers) {
    const byModel = new Map<string, {
      tokens: number;
      cost: number;
      inputTokens: number;
      cacheReadTokens: number;
      events: number;
    }>();

    for (const day of provider.daily) {
      for (const model of day.models) {
        const current = byModel.get(model.model) ?? {
          tokens: 0,
          cost: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
          events: 0,
        };
        current.tokens += model.totalTokens;
        current.cost += model.cost;
        current.inputTokens += model.inputTokens;
        current.cacheReadTokens += model.cacheReadTokens;
        current.events += 1;
        byModel.set(model.model, current);
      }
    }

    for (const [model, value] of byModel) {
      const cacheDenominator = value.inputTokens + value.cacheReadTokens;
      entries.push({
        provider: provider.provider,
        model,
        tokensBucket: bucketNumber(value.tokens, 10_000),
        costBucket: bucketCost(value.cost),
        cacheHitRateBucket: bucketRate(cacheDenominator > 0 ? value.cacheReadTokens / cacheDenominator : 0),
        eventCountBucket: bucketNumber(value.events, 10),
      });
    }
  }

  return entries.sort((left, right) => (
    left.provider.localeCompare(right.provider) ||
    left.model.localeCompare(right.model)
  ));
}

function buildProjectBuckets(output: TokenleakOutput): CommonsBucketEntry[] {
  const buckets = new Map<string, number>();
  for (const project of output.more?.projectDrilldown ?? []) {
    incrementBucket(buckets, bucketNumber(project.totalTokens, 25_000));
  }
  return mapToEntries(buckets);
}

function buildSessionBuckets(output: TokenleakOutput): CommonsBucketEntry[] {
  const buckets = new Map<string, number>();
  for (const session of output.more?.sessionDrilldown ?? []) {
    incrementBucket(buckets, bucketNumber(session.totalTokens, 10_000));
  }
  return mapToEntries(buckets);
}

export function buildCommonsExport(output: TokenleakOutput): CommonsExport {
  return {
    schemaVersion: 1,
    generated: output.generated,
    dateRange: output.dateRange,
    privacy: {
      containsPrompts: false,
      containsPaths: false,
      containsRepoNames: false,
      containsSessionIds: false,
      containsExactTimestamps: false,
      granularity: 'aggregate-v1',
    },
    totals: {
      tokensBucket: bucketNumber(output.aggregated.totalTokens, 50_000),
      costBucket: bucketCost(output.aggregated.totalCost),
      activeDaysBucket: bucketNumber(output.aggregated.activeDays, 5),
      providerCount: output.providers.length,
      cacheHitRateBucket: bucketRate(output.aggregated.cacheHitRate),
    },
    providerModels: providerModelEntries(output),
    dayOfWeek: output.aggregated.dayOfWeek.map((entry) => ({
      label: entry.label,
      count: Math.round(entry.count),
    })),
    hourOfDay: (output.more?.hourOfDay ?? []).map((entry) => ({
      label: String(entry.hour).padStart(2, '0'),
      count: entry.count,
    })),
    projectBuckets: buildProjectBuckets(output),
    sessionBuckets: buildSessionBuckets(output),
  };
}

export function buildCommonsPromptExport(exportData: CommonsExport): string {
  const payload = JSON.stringify(exportData, null, 2);

  return [
    '# Tokenleak LLM Analysis Prompt',
    '',
    'You are analyzing anonymized aggregate AI coding-assistant usage data from Tokenleak.',
    'Use only the data below. Treat every bucket as approximate, and do not infer private repo names, file paths, prompts, session IDs, or exact timestamps.',
    '',
    '## Privacy Guarantees',
    '',
    `- Contains prompts: ${exportData.privacy.containsPrompts}`,
    `- Contains paths: ${exportData.privacy.containsPaths}`,
    `- Contains repo names: ${exportData.privacy.containsRepoNames}`,
    `- Contains session IDs: ${exportData.privacy.containsSessionIds}`,
    `- Contains exact timestamps: ${exportData.privacy.containsExactTimestamps}`,
    `- Granularity: ${exportData.privacy.granularity}`,
    '',
    '## Analysis Goals',
    '',
    'Produce a concise usage analysis for a developer or engineering team. Include:',
    '',
    '1. A short executive summary of the most important patterns.',
    '2. Spend and token optimization opportunities.',
    '3. Model-mix observations and cheaper-model routing suggestions.',
    '4. Cache efficiency observations.',
    '5. Time-of-day and day-of-week workflow patterns.',
    '6. Project/session-size observations from bucketed data only.',
    '7. A prioritized action list with expected impact and confidence.',
    '8. Follow-up questions that would improve the analysis without requesting private prompts, paths, repo names, or session IDs.',
    '',
    '## Data',
    '',
    '```json',
    payload,
    '```',
    '',
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function isBucketEntry(value: unknown): value is CommonsBucketEntry {
  return (
    isRecord(value) &&
    typeof value['label'] === 'string' &&
    typeof value['count'] === 'number' &&
    Number.isFinite(value['count'])
  );
}

function validateBucketArray(value: unknown, key: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array.`);
    return;
  }

  value.forEach((entry, index) => {
    if (!isBucketEntry(entry)) {
      errors.push(`${key}[${index}] must have string label and finite numeric count.`);
    }
  });
}

function isProviderModelEntry(value: unknown): value is CommonsProviderModelEntry {
  return (
    isRecord(value) &&
    typeof value['provider'] === 'string' &&
    typeof value['model'] === 'string' &&
    typeof value['tokensBucket'] === 'string' &&
    typeof value['costBucket'] === 'string' &&
    typeof value['cacheHitRateBucket'] === 'string' &&
    typeof value['eventCountBucket'] === 'string'
  );
}

function validateProviderModels(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('providerModels must be an array.');
    return;
  }

  value.forEach((entry, index) => {
    if (!isProviderModelEntry(entry)) {
      errors.push(`providerModels[${index}] must match the provider/model bucket shape.`);
    }
  });
}

export function inspectCommonsExport(value: unknown): CommonsInspectReport {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ['Export must be a JSON object.'],
      summary: {
        providerModels: 0,
        dayOfWeekBuckets: 0,
        hourOfDayBuckets: 0,
        projectBuckets: 0,
        sessionBuckets: 0,
      },
    };
  }

  if (value['schemaVersion'] !== 1) {
    errors.push('schemaVersion must be 1.');
  }

  const privacy = value['privacy'];
  if (!isRecord(privacy)) {
    errors.push('privacy block is missing.');
  } else {
    for (const key of [
      'containsPrompts',
      'containsPaths',
      'containsRepoNames',
      'containsSessionIds',
      'containsExactTimestamps',
    ]) {
      if (privacy[key] !== false) {
        errors.push(`privacy.${key} must be false.`);
      }
    }
    if (privacy['granularity'] !== 'aggregate-v1') {
      errors.push('privacy.granularity must be aggregate-v1.');
    }
  }

  validateProviderModels(value['providerModels'], errors);
  validateBucketArray(value['dayOfWeek'], 'dayOfWeek', errors);
  validateBucketArray(value['hourOfDay'], 'hourOfDay', errors);
  validateBucketArray(value['projectBuckets'], 'projectBuckets', errors);
  validateBucketArray(value['sessionBuckets'], 'sessionBuckets', errors);

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      providerModels: arrayLength(value['providerModels']),
      dayOfWeekBuckets: arrayLength(value['dayOfWeek']),
      hourOfDayBuckets: arrayLength(value['hourOfDay']),
      projectBuckets: arrayLength(value['projectBuckets']),
      sessionBuckets: arrayLength(value['sessionBuckets']),
    },
  };
}
