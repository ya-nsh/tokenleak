import type {
  AgentWasteReport,
  AgentWasteSignal,
  ProviderData,
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

function redactSignal(signal: AgentWasteSignal): AgentWasteSignal {
  // Prompt-repeat evidence quotes the clustered prompt itself.
  if (signal.kind !== 'prompt-repeat') return signal;
  return {
    ...signal,
    evidence: {
      ...signal.evidence,
      reason: `${signal.evidence.eventCount} similar prompts clustered (${OMITTED_PROMPT_REASON}).`,
    },
  };
}

/** Strip quoted prompt text from waste evidence before it is exported. */
export function redactWasteReportForExport(report: AgentWasteReport): AgentWasteReport {
  return { ...report, signals: report.signals.map(redactSignal) };
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
  const agentWaste = output.optimization?.agentWaste;
  return {
    ...output,
    providers: output.providers.map(redactProvider),
    ...(output.optimization
      ? {
          optimization: {
            ...output.optimization,
            ...(agentWaste
              ? { agentWaste: redactWasteReportForExport(agentWaste) }
              : {}),
          },
        }
      : {}),
  };
}
