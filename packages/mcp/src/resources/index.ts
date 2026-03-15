import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProviderRegistry } from '@tokenleak/registry';
import { handleOverview } from './overview.js';
import { handleProvider } from './provider.js';

export function registerResources(server: McpServer, registry: ProviderRegistry): void {
  server.resource(
    'overview',
    'tokenleak://overview',
    {
      description: '30-day token usage overview across all providers',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'tokenleak://overview',
          mimeType: 'application/json',
          text: await handleOverview(registry),
        },
      ],
    }),
  );

  const providerTemplate = new ResourceTemplate(
    'tokenleak://provider/{name}',
    {
      list: async () => {
        const all = registry.getAll();
        return {
          resources: all.map((p) => ({
            uri: `tokenleak://provider/${p.name}`,
            name: p.displayName,
            description: `Token usage data for ${p.displayName}`,
            mimeType: 'application/json',
          })),
        };
      },
      complete: undefined,
    },
  );

  server.resource(
    'provider',
    providerTemplate,
    {
      description: 'Per-provider token usage data for the last 30 days',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const name = typeof variables.name === 'string'
        ? variables.name
        : Array.isArray(variables.name) ? variables.name[0] ?? '' : '';
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: await handleProvider(name, registry),
          },
        ],
      };
    },
  );
}
