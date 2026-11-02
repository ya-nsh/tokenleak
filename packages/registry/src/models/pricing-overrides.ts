import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelPricing } from './pricing';
import { normalizeModelName } from './normalizer';

const OVERRIDE_FILENAME = 'pricing.json';
/** Anthropic-style defaults applied when an override omits cache rates. */
const DEFAULT_CACHE_READ_MULTIPLIER = 0.1;
const DEFAULT_CACHE_WRITE_MULTIPLIER = 1.25;
const REQUIRED_RATES = ['input', 'output'] as const;
const OPTIONAL_RATES = ['cacheRead', 'cacheWrite', 'cacheWrite1h'] as const;

/** Raised when the user's pricing override file exists but cannot be used. */
export class PricingOverrideError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(
      `Invalid pricing override file ${path}: ${reason}. ` +
        'Expected {"models": {"<model>": {"input": <USD per 1M>, "output": <USD per 1M>, ' +
        '"cacheRead"?: n, "cacheWrite"?: n, "cacheWrite1h"?: n}}}.',
    );
    this.name = 'PricingOverrideError';
  }
}

/**
 * Location of the user's pricing overrides. `TOKENLEAK_PRICING_FILE` wins,
 * then `~/.config/tokenleak/pricing.json`.
 */
export function getPricingOverridePath(): string {
  const explicit = process.env['TOKENLEAK_PRICING_FILE'];
  if (explicit && explicit.trim().length > 0) return explicit;
  return join(homedir(), '.config', 'tokenleak', OVERRIDE_FILENAME);
}

function readRate(path: string, model: string, field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PricingOverrideError(path, `"${model}.${field}" must be a non-negative number`);
  }
  return value;
}

/**
 * Parse an override document. Model names are normalized the same way usage
 * events are, so `claude-opus-5-5-20260101` and `claude-opus-5-5` collide.
 */
export function parsePricingOverrides(path: string, raw: unknown): Record<string, ModelPricing> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PricingOverrideError(path, 'the top level must be an object');
  }
  const models = (raw as Record<string, unknown>)['models'];
  if (typeof models !== 'object' || models === null || Array.isArray(models)) {
    throw new PricingOverrideError(path, '"models" must be an object keyed by model name');
  }

  const overrides: Record<string, ModelPricing> = {};
  for (const [name, value] of Object.entries(models)) {
    const model = normalizeModelName(name);
    if (model.length === 0) {
      throw new PricingOverrideError(path, 'model names must not be empty');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new PricingOverrideError(path, `"${name}" must be an object of rates`);
    }
    const rates = value as Record<string, unknown>;
    const unknownField = Object.keys(rates).find(
      (field) =>
        !(REQUIRED_RATES as readonly string[]).includes(field) &&
        !(OPTIONAL_RATES as readonly string[]).includes(field),
    );
    if (unknownField) {
      throw new PricingOverrideError(path, `"${name}.${unknownField}" is not a pricing field`);
    }
    const input = readRate(path, name, 'input', rates['input']);
    const output = readRate(path, name, 'output', rates['output']);
    const cacheRead =
      rates['cacheRead'] === undefined
        ? input * DEFAULT_CACHE_READ_MULTIPLIER
        : readRate(path, name, 'cacheRead', rates['cacheRead']);
    const cacheWrite =
      rates['cacheWrite'] === undefined
        ? input * DEFAULT_CACHE_WRITE_MULTIPLIER
        : readRate(path, name, 'cacheWrite', rates['cacheWrite']);
    overrides[model] = {
      input,
      output,
      cacheRead,
      cacheWrite,
      ...(rates['cacheWrite1h'] !== undefined
        ? { cacheWrite1h: readRate(path, name, 'cacheWrite1h', rates['cacheWrite1h']) }
        : {}),
    };
  }
  return overrides;
}

/** Load overrides from disk. A missing file means no overrides. */
export function loadPricingOverrides(path = getPricingOverridePath()): Record<string, ModelPricing> {
  if (!existsSync(path)) return {};
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error: unknown) {
    throw new PricingOverrideError(path, `cannot be read (${(error as Error).message})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    throw new PricingOverrideError(path, `is not valid JSON (${(error as Error).message})`);
  }
  return parsePricingOverrides(path, raw);
}
