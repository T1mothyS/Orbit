import { expect, type BrowserContext } from '@playwright/test';
const tokens = new Map<string, Promise<string>>();
/** Reuse real logins within a worker; the expanded matrix must not exhaust the IP login budget. */
export async function fixtureToken(context: BrowserContext, email: string): Promise<string> {
  if (!tokens.has(email)) tokens.set(email, (async () => {
    const result = await context.request.post('http://127.0.0.1:4187/api/auth/login', { data: { email, password: 'OrbitPreview123!' } });
    expect(result.status()).toBe(200); return (await result.json()).token as string;
  })());
  return tokens.get(email)!;
}
