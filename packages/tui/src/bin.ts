#!/usr/bin/env bun
/** Standalone entrypoint for `bun run dev` — keeps index.ts import-only. */
import { main } from './index.js';

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
