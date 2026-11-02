#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initPricing } from '@tokenleak/registry';
import { createTokenleakServer } from './server.js';

// Load cached and user-override rates before any tool prices usage.
await initPricing();

const server = createTokenleakServer();
const transport = new StdioServerTransport();

await server.connect(transport);
