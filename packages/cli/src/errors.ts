/**
 * Custom error class for Tokenleak CLI errors.
 */
export class TokenleakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenleakError';
  }
}

/**
 * Handles an error by printing a clear message and exiting with code 1.
 */
export function handleError(error: unknown): never {
  if (error instanceof TokenleakError) {
    process.stderr.write(`Error: ${error.message}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`Error: ${error.message}\n`);
  } else {
    process.stderr.write(`Error: ${String(error)}\n`);
  }
  process.exit(1);
}
