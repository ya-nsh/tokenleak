import { buildCursorHelpText, runCursorCommand } from '../cursor.js';
import { buildVersionText } from '../report-output.js';

/** `tokenleak cursor <action>`: `argv` is everything after the subcommand name. */
export async function cursorCommand(argv: string[]): Promise<void> {
  const first = argv[0];
  if (first === undefined || first === '--help' || first === '-h') {
    process.stdout.write(buildCursorHelpText());
    return;
  }
  if (first === '--version' || first === '-v') {
    process.stdout.write(buildVersionText());
    return;
  }
  await runCursorCommand(argv);
}
