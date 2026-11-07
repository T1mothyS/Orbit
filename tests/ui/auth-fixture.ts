import { expect, request, type APIRequestContext, type BrowserContext } from '@playwright/test';

const origin = 'http://127.0.0.1:4187';
const sharedAccounts = ['preview', 'preview-guards', 'preview-settings'];
const tokens = new Map<string, Promise<string>>();

async function login(client: APIRequestContext, email: string): Promise<string> {
  const response = await client.post(origin + '/api/auth/login', {
    data: { email, password: 'OrbitPreview123!' },
  });
  expect(response.status(), `Synthetic fixture login for ${email}`).toBe(200);
  return (await response.json()).token as string;
}

/** Share real sessions across workers and retries only for stable synthetic accounts. */
export default async function seedSharedSessions() {
  const client = await request.newContext();
  try {
    const sessions: Record<string, string> = {};
    for (const name of sharedAccounts) {
      const email = name + '@example.invalid';
      sessions[email] = await login(client, email);
    }
    process.env.ORBIT_UI_SHARED_SESSIONS = JSON.stringify(sessions);
  } finally {
    await client.dispose();
  }
}

export async function fixtureToken(context: BrowserContext, email: string): Promise<string> {
  const shared = JSON.parse(process.env.ORBIT_UI_SHARED_SESSIONS || '{}') as Record<string, string>;
  if (!tokens.has(email)) tokens.set(email, shared[email] ? Promise.resolve(shared[email]) : login(context.request, email));
  const token = await tokens.get(email)!;
  // Each test gets its own protected-page cookie through the real authenticated API.
  const me = await context.request.get(origin + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  expect(me.status()).toBe(200);
  return token;
}
