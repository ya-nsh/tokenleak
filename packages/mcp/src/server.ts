import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ProviderRegistry,
  ClaudeCodeProvider,
  CodexProvider,
  CursorProvider,
  GeminiProvider,
  CopilotProvider,
  AmpProvider,
  QwenProvider,
  RooCodeProvider,
  KiloCodeProvider,
  OpenClawProvider,
  HermesProvider,
  PiProvider,
  OpenCodeProvider,
} from '@tokenleak/registry';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';

/**
 * Create a Tokenleak MCP server with all tools and resources registered.
 *
 * @param registry - Optional provider registry. If omitted, a default registry
 *   with all built-in providers (Claude Code, Codex, Cursor, Pi, OpenCode) is created.
 */
export function createTokenleakServer(registry?: ProviderRegistry): McpServer {
  const reg = registry ?? createDefaultRegistry();

  const server = new McpServer({
    name: 'tokenleak',
    version: '2.1.0',
  });

  registerTools(server, reg);
  registerResources(server, reg);

  return server;
}

function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new ClaudeCodeProvider());
  registry.register(new CodexProvider());
  registry.register(new CursorProvider());
  registry.register(new GeminiProvider());
  registry.register(new CopilotProvider());
  registry.register(new AmpProvider());
  registry.register(new QwenProvider());
  registry.register(new RooCodeProvider());
  registry.register(new KiloCodeProvider());
  registry.register(new OpenClawProvider());
  registry.register(new HermesProvider());
  registry.register(new PiProvider());
  registry.register(new OpenCodeProvider());
  return registry;
}
