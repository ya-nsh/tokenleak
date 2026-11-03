import { writeFileSync } from 'node:fs';
import { buildReceipt } from '@tokenleak/core';
import { renderReceiptPng, renderReceiptSvg } from '@tokenleak/renderers';
import { loadTokenleakData } from '../data-loader.js';
import { computeDateRange } from '../date-range.js';
import { TokenleakError } from '../errors.js';
import {
  emitProviderWarnings,
  selectAvailableProviders,
  validateProviderSelection,
} from '../providers.js';
import {
  buildReceiptsHelpText,
  collectEventsForReceipt,
  renderReceiptTerminal,
} from '../receipts.js';
import { inferFormatFromPath, resolveConfig } from '../report-options.js';
import { copyToClipboard, openFile, uploadToGist } from '../sharing/index.js';
import { printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';

export function parseReceiptsArgs(argv: string[]): Record<string, unknown> {
  const cliArgs: Record<string, unknown> = {};
  let index = 0;

  while (index < argv.length) {
    const arg = argv[index]!;
    switch (arg) {
      case '--help':
      case '-h':
        cliArgs['help'] = true;
        index += 1;
        break;
      case '--version':
      case '-v':
        cliArgs['version'] = true;
        index += 1;
        break;
      case '--format':
      case '-f':
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        cliArgs['format'] = argv[index + 1]!;
        index += 2;
        break;
      case '--output':
      case '-o':
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        cliArgs['output'] = argv[index + 1]!;
        index += 2;
        break;
      case '--since':
      case '-s':
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        cliArgs['since'] = argv[index + 1]!;
        index += 2;
        break;
      case '--until':
      case '-u':
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        cliArgs['until'] = argv[index + 1]!;
        index += 2;
        break;
      case '--days':
      case '-d':
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        cliArgs['days'] = Number(argv[index + 1]!);
        index += 2;
        break;
      case '--theme':
      case '-t':
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        cliArgs['theme'] = argv[index + 1]!;
        index += 2;
        break;
      case '--provider':
      case '-p':
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        cliArgs['provider'] = argv[index + 1]!;
        index += 2;
        break;
      case '--width':
      case '-w': {
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        const width = Number(argv[index + 1]!);
        if (!Number.isInteger(width) || width <= 0) {
          throw new TokenleakError('--width must be a positive integer');
        }
        cliArgs['width'] = width;
        index += 2;
        break;
      }
      case '--top': {
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        const parsed = Number(argv[index + 1]!);
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
          throw new TokenleakError('--top must be a positive integer');
        }
        cliArgs['top'] = parsed;
        index += 2;
        break;
      }
      case '--claude':
        cliArgs['claude'] = true;
        index += 1;
        break;
      case '--codex':
        cliArgs['codex'] = true;
        index += 1;
        break;
      case '--cursor':
        cliArgs['cursor'] = true;
        index += 1;
        break;
      case '--pi':
        cliArgs['pi'] = true;
        index += 1;
        break;
      case '--openCode':
      case '--open-code':
        cliArgs['openCode'] = true;
        index += 1;
        break;
      case '--allProviders':
      case '--all-providers':
        cliArgs['allProviders'] = true;
        index += 1;
        break;
      case '--noColor':
      case '--no-color':
        cliArgs['noColor'] = true;
        index += 1;
        break;
      case '--clipboard':
        cliArgs['clipboard'] = true;
        index += 1;
        break;
      case '--open':
        cliArgs['open'] = true;
        index += 1;
        break;
      case '--upload':
        if (argv[index + 1] === undefined) throw new TokenleakError(`${arg} requires a value`);
        cliArgs['upload'] = argv[index + 1]!;
        index += 2;
        break;
      default:
        throw new TokenleakError(
          `Unknown flag "${arg}" for \`tokenleak receipts\`. Run \`tokenleak receipts --help\` for usage.`,
        );
    }
  }

  return cliArgs;
}

export function inferReceiptsFormat(
  cliArgs: Record<string, unknown>,
): 'terminal' | 'svg' | 'png' | 'json' {
  const explicit = cliArgs['format'];
  if (typeof explicit === 'string') {
    if (
      explicit === 'terminal' ||
      explicit === 'svg' ||
      explicit === 'png' ||
      explicit === 'json'
    ) {
      return explicit;
    }
    throw new TokenleakError(
      `Unknown receipts format "${explicit}" (use terminal, svg, png, or json)`,
    );
  }
  const output = cliArgs['output'];
  if (typeof output === 'string') {
    const inferred = inferFormatFromPath(output);
    if (inferred === 'svg' || inferred === 'png' || inferred === 'json') {
      return inferred;
    }
  }
  return 'terminal';
}

/**
 * Validate the combination of format + share flags for the receipts subcommand.
 * Throws TokenleakError on any disallowed combination; returns void on success.
 * Exported for unit tests; {@link runReceipts} is the only runtime caller.
 */
export function validateReceiptsShareFlags(
  format: 'terminal' | 'svg' | 'png' | 'json',
  flags: { output: string | null; open: boolean; upload?: string },
): void {
  if (format === 'png' && !flags.output) {
    throw new TokenleakError('--output <path> is required for --format png');
  }
  if (flags.open && !flags.output) {
    throw new TokenleakError('--open requires --output to specify a file path');
  }
  if (flags.upload !== undefined && flags.upload !== 'gist') {
    throw new TokenleakError(`Unknown upload target "${flags.upload}". Supported: gist`);
  }
  if (flags.upload === 'gist' && format === 'png') {
    // Gist cannot host binary images as-is; a base64 text blob is not a
    // viewable PNG and would silently diverge from --upload gist for other
    // formats. Reject explicitly and tell the caller what to do.
    throw new TokenleakError(
      '--upload gist does not support --format png (gist cannot host binary images). ' +
        'Use --format svg or --format json, or share the --output file directly.',
    );
  }
}

export async function runReceipts(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  validateProviderSelection(config);

  const format = inferReceiptsFormat(cliArgs);
  const theme: 'dark' | 'light' = config.theme === 'light' ? 'light' : 'dark';
  const topLines =
    typeof cliArgs['top'] === 'number' && Number.isFinite(cliArgs['top'] as number)
      ? (cliArgs['top'] as number)
      : undefined;

  validateReceiptsShareFlags(format, {
    output: config.output ?? null,
    open: config.open,
    upload: config.upload,
  });

  const range = computeDateRange({ since: config.since, until: config.until, days: config.days });
  const available = await selectAvailableProviders(config);
  if (available.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  const data = await loadTokenleakData(available, range);
  emitProviderWarnings(data.providers);
  const events = collectEventsForReceipt(data.providers);
  const receipt = buildReceipt(events, range, topLines !== undefined ? { topLines } : {});

  // Render once, then share. The rendered artefact is a string for every
  // format except png (Buffer).
  let rendered: string | Buffer;
  if (format === 'json') {
    rendered = JSON.stringify(receipt, null, 2);
  } else if (format === 'svg') {
    rendered = renderReceiptSvg(receipt, { theme });
  } else if (format === 'png') {
    rendered = await renderReceiptPng(receipt, { theme });
  } else {
    rendered = renderReceiptTerminal(receipt, config.width);
  }

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else if (typeof rendered === 'string') {
    process.stdout.write(rendered + '\n');
  }

  // Sharing: clipboard
  if (config.clipboard) {
    if (format === 'png') {
      process.stderr.write(
        'Clipboard is not supported for binary PNG output. Use --output to save the file.\n',
      );
    } else {
      const text = typeof rendered === 'string' ? rendered : rendered.toString('utf-8');
      await copyToClipboard(text);
      process.stderr.write('Copied receipt to clipboard.\n');
    }
  }

  // Sharing: open generated file
  if (config.open && config.output) {
    await openFile(config.output);
    process.stderr.write(`Opened ${config.output} in default application.\n`);
  }

  // Sharing: upload to gist
  if (config.upload === 'gist') {
    // png + gist is rejected up-front, so rendered is always a string here.
    const ext = format === 'json' ? 'json' : format === 'svg' ? 'svg' : 'txt';
    const filename = `tokenleak-receipt.${ext}`;
    const description = `Tokenleak receipt (${range.since} to ${range.until})`;
    const url = await uploadToGist(rendered as string, filename, description);
    process.stderr.write(
      `Uploaded to a secret gist (unlisted; anyone with the link can view it): ${url}\n`,
    );
  }
}

/** `tokenleak receipts`: `argv` is everything after the subcommand name. */
export async function receiptsCommand(argv: string[]): Promise<void> {
  const cliArgs = parseReceiptsArgs(argv);
  if (printInfoFlag(cliArgs, buildReceiptsHelpText)) return;
  await initPricing();
  await runReceipts(cliArgs);
}
