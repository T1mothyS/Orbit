import { ProxyAgent } from 'undici';

const origins = new Set(['https://api.openai.com', 'https://auth.openai.com']);
let cached: { value: string; agent: ProxyAgent } | undefined;

function proxyAgent(value: string): ProxyAgent {
  if (cached?.value === value) return cached.agent;
  let agent: ProxyAgent;
  try {
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname
      || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error();
    const username = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    if (/[\r\n]/.test(username + password)) throw new Error();
    agent = new ProxyAgent({
      uri: url.origin,
      ...(username || password ? { token: 'Basic ' + Buffer.from(username + ':' + password).toString('base64') } : {}),
    });
  } catch {
    // The configured URL may contain credentials. Never put it in an error.
    throw new Error('ORBIT_OPENAI_PROXY_URL 必须是不含路径、查询或片段的 HTTP(S) 代理地址');
  }
  const previous = cached;
  cached = { value, agent };
  if (previous) void previous.agent.close().catch(() => {});
  return agent;
}

/** Optional OpenAI-only transport. Other clients retain their existing fetch/agents. */
export const openAIFetch: typeof fetch = async (input, init) => {
  const value = process.env.ORBIT_OPENAI_PROXY_URL?.trim();
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (!value || !origins.has(target.origin)) return fetch(input, init);
  // Following a redirect with the same dispatcher could proxy a different origin.
  // OpenAI API and issuer endpoints are fixed, so fail explicitly on redirects.
  return fetch(input, { ...init, dispatcher: proxyAgent(value), redirect: 'error' } as RequestInit);
};
