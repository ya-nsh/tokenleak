import type { ProviderRegistry } from '@tokenleak/registry';

export async function handleListProviders(
  _args: Record<string, never>,
  registry: ProviderRegistry,
) {
  try {
    const all = registry.getAll();
    const availability = await Promise.all(
      all.map(async (p) => ({
        name: p.name,
        displayName: p.displayName,
        available: await p.isAvailable(),
      })),
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(availability, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: message }],
    };
  }
}
