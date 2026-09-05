import type { QuotaProvider, QuotaWindow } from '@tokenleak/core';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function safeLabel(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 80)
    : null;
}
function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function date(value: unknown): string | null {
  const ms =
    typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 && ms < 8.64e15 ? new Date(ms).toISOString() : null;
}
function window(
  id: string,
  label: string,
  used: unknown,
  reset: unknown,
  unlimited = false,
): QuotaWindow {
  const usedPercent = unlimited ? null : number(used);
  return {
    id,
    label,
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    resetsAt: date(reset),
    unlimited,
  };
}
/** Normalize provider payloads without inferring capacity from missing values. */
export function normalizeQuota(
  provider: QuotaProvider,
  payload: unknown,
): { plan: string | null; windows: QuotaWindow[] } {
  const data = record(payload);
  const windows: QuotaWindow[] = [];
  let plan: string | null = null;
  if (provider === 'claude') {
    for (const [key, value] of Object.entries(data)) {
      if (!/^(five_hour|seven_day)(_|$)/.test(key) || value === null) continue;
      const bucket = record(value);
      const label =
        key === 'five_hour'
          ? 'Session (5h)'
          : key === 'seven_day'
            ? 'Weekly'
            : `Weekly ${key.slice('seven_day_'.length).replaceAll('_', ' ')}`;
      windows.push(window(key, safeLabel(label)!, bucket.utilization, bucket.resets_at));
    }
    for (const raw of Array.isArray(data.limits) ? data.limits : []) {
      const bucket = record(raw);
      const scope = record(record(bucket.scope).model);
      const label = safeLabel(scope.display_name) ?? safeLabel(scope.id);
      if (bucket.kind === 'session' || bucket.kind === 'weekly_all') {
        const id = bucket.kind === 'session' ? 'five_hour' : 'seven_day';
        if (!windows.some((item) => item.id === id))
          windows.push(
            window(
              id,
              id === 'five_hour' ? 'Session (5h)' : 'Weekly',
              bucket.percent,
              bucket.resets_at,
            ),
          );
        continue;
      }
      if (bucket.kind !== 'weekly_scoped' || !label) continue;
      const id = `seven_day_${label.toLowerCase().replaceAll(' ', '_')}`;
      const normalized = window(id, `Weekly ${label}`, bucket.percent, bucket.resets_at);
      const existing = windows.findIndex((item) => item.id === id);
      if (existing >= 0) windows[existing] = normalized;
      else windows.push(normalized);
    }
  } else if (provider === 'codex') {
    plan = safeLabel(data.plan_type);
    const groups = [
      { name: 'Codex', rate: data.rate_limit },
      ...(Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : []).map(
        (item) => {
          const row = record(item);
          return {
            name: safeLabel(row.limit_name) ?? safeLabel(row.metered_feature) ?? 'Additional',
            rate: row.rate_limit,
          };
        },
      ),
    ];
    for (const [index, group] of groups.entries()) {
      for (const key of ['primary_window', 'secondary_window']) {
        const value = record(group.rate)[key];
        if (value === null || value === undefined) continue;
        const bucket = record(value);
        const seconds = number(bucket.limit_window_seconds);
        const period =
          seconds === 604800
            ? 'Weekly'
            : seconds === 18000
              ? 'Session (5h)'
              : seconds
                ? `${seconds / 3600}h window`
                : key === 'primary_window'
                  ? 'Primary'
                  : 'Secondary';
        windows.push(
          window(
            `${index}:${key}`,
            `${group.name} ${period}`,
            bucket.used_percent,
            bucket.reset_at ?? bucket.resets_at,
          ),
        );
      }
    }
  } else {
    plan = safeLabel(data.copilot_plan);
    for (const [key, value] of Object.entries(record(data.quota_snapshots))) {
      const bucket = record(value);
      const remaining = number(bucket.percent_remaining);
      const count = number(bucket.remaining);
      const entitlement = number(bucket.entitlement);
      const used =
        remaining !== null
          ? Math.max(0, 100 - remaining)
          : count !== null && entitlement !== null && entitlement > 0
            ? Math.max(0, 100 * (1 - count / entitlement))
            : null;
      windows.push(
        window(
          key,
          safeLabel(key.replaceAll('_', ' '))!,
          used,
          data.quota_reset_date,
          bucket.unlimited === true,
        ),
      );
    }
    if (windows.length === 0) {
      for (const [key, value] of Object.entries(record(data.limited_user_quotas))) {
        const remaining = number(value);
        const total = number(record(data.monthly_quotas)[key]);
        windows.push(
          window(
            key,
            safeLabel(key.replaceAll('_', ' '))!,
            remaining !== null && total !== null && total > 0
              ? Math.max(0, 100 * (1 - remaining / total))
              : null,
            data.limited_user_reset_date,
          ),
        );
      }
    }
  }
  return { plan, windows };
}
