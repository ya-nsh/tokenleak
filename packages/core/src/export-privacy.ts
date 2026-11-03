import type {
  ProviderData,
  SavingsRecommendation,
  SavingsReport,
  TokenleakOutput,
  UsageEvent,
} from './types';

const OMITTED_PROMPT_REASON = 'prompt text omitted from export; pass --include-prompts to keep it';

function withoutPrompt(event: UsageEvent): UsageEvent {
  if (event.prompt === undefined) return event;
  const copy: UsageEvent = { ...event };
  delete copy.prompt;
  return copy;
}

function redactProvider(provider: ProviderData): ProviderData {
  if (!provider.events?.some((event) => event.prompt !== undefined)) return provider;
  return { ...provider, events: provider.events.map(withoutPrompt) };
}

function redactRecommendation(recommendation: SavingsRecommendation): SavingsRecommendation {
  // Prompt-repeat evidence quotes the clustered prompt itself.
  if (recommendation.kind !== 'prompt-repeat') return recommendation;
  return {
    ...recommendation,
    evidence: {
      ...recommendation.evidence,
      reason: `${recommendation.evidence.eventCount} similar prompts clustered (${OMITTED_PROMPT_REASON}).`,
    },
  };
}

/** Strip quoted prompt text from savings evidence before it is exported. */
export function redactSavingsReportForExport(report: SavingsReport): SavingsReport {
  return { ...report, recommendations: report.recommendations.map(redactRecommendation) };
}

/**
 * Remove captured prompt text from output that is about to leave the
 * machine (files, clipboard, gists). Prompts routinely contain pasted
 * secrets, customer data, and private code; usage numbers do not.
 *
 * Returns a new object and never mutates the input. Prompt IDs are kept so
 * events can still be grouped by turn.
 */
export function redactPromptsForExport(output: TokenleakOutput): TokenleakOutput {
  const savings = output.optimization?.savings;
  return {
    ...output,
    providers: output.providers.map(redactProvider),
    ...(output.optimization
      ? {
          optimization: {
            ...output.optimization,
            ...(savings ? { savings: redactSavingsReportForExport(savings) } : {}),
          },
        }
      : {}),
  };
}
