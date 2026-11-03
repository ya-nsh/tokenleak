import { DEFAULT_DAYS, VERSION } from '@tokenleak/core';
import {
  getPricingOverridePath,
  getRemotePricingStatus,
  initPricing,
  resolveModelPricing,
} from '@tokenleak/registry';
import { buildPricingReport, renderPricingReport } from '../pricing-report.js';
import { loadOptimizationInput } from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { writeReportOutput } from '../report-output.js';
import { parseOptimizationArgs, printInfoFlag } from '../args.js';

export function buildPricingHelpText(): string {
  return [
    `tokenleak pricing ${VERSION}`,
    'Show every model in your usage, its rates, and where each price came from.',
    '',
    'Usage:',
    '  tokenleak pricing [flags]',
    '',
    'Sources: your override file, the verified built-in table, or the model',
    "vendor's own LiteLLM row. Unknown models are listed so you can price them in",
    `${getPricingOverridePath()}.`,
    '',
    'Flags:',
    '  -f, --format <format>   Output format: terminal, json',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -o, --output <path>     Write output to a file',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --no-color          Disable ANSI colors',
    '',
  ].join('\n');
}

export async function runPricing(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  const format = resolveTerminalJsonFormat('pricing', cliArgs);
  const { dateRange, providers } = await loadOptimizationInput(config);
  const report = buildPricingReport(
    providers.flatMap((provider) => provider.events ?? []),
    dateRange,
    {
      resolve: (model) => resolveModelPricing(model),
      overridePath: getPricingOverridePath(),
      remote: getRemotePricingStatus(),
    },
  );
  const rendered =
    format === 'json'
      ? JSON.stringify(report, null, 2)
      : renderPricingReport(report, { noColor: config.noColor });
  await writeReportOutput(rendered, config.output);
}

/** `tokenleak pricing`: `argv` is everything after the subcommand name. */
export async function pricingCommand(argv: string[]): Promise<void> {
  const cliArgs = parseOptimizationArgs(argv);
  if (printInfoFlag(cliArgs, buildPricingHelpText)) return;
  await initPricing();
  await runPricing(cliArgs);
}
