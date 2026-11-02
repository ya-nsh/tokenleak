interface FlushableStream {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
  writableLength?: number;
}

/** Resolve once everything already written to `stream` has been handed to the OS. */
export function flushStream(stream: FlushableStream): Promise<void> {
  if (stream.writableLength === 0) return Promise.resolve();
  // Writes complete in order, so an empty write's callback fires after the rest.
  return new Promise((resolve) => {
    stream.write('', () => resolve());
  });
}

/**
 * Exit after stdout and stderr drain. `process.exit()` drops whatever is
 * still buffered for a pipe, which cut `tokenleak --format json | jq`
 * off at exactly 128 KB.
 */
export async function exitAfterFlush(code: number): Promise<never> {
  await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
  process.exit(code);
}
