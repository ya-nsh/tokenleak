#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTokenleakServer } from './server.js';

const server = createTokenleakServer();
const transport = new StdioServerTransport();

await server.connect(transport);
