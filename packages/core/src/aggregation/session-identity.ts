export function sessionKey(provider: string, sessionId: string): string {
  return JSON.stringify([provider, sessionId]);
}
