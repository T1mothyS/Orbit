import { relaySignature } from './digest-media-worker.js';
import { publicDigestUrl } from './digest-v2-contract.js';
import { fetchDigestImage, proxiedDigestFetcher } from './digest-v2-fetch.js';

export function digestMediaFetcher(): { fetcher: typeof fetch; transport: 'network' | 'cloudflare_worker' | 'http_proxy' } {
  const endpoint = process.env.DIGEST_MEDIA_RELAY_URL;
  const secret = process.env.DIGEST_MEDIA_RELAY_SECRET;
  const proxy = process.env.DIGEST_MEDIA_PROXY_URL;
  if (proxy) {
    if (endpoint || secret) throw new Error('MEDIA_PROXY_RELAY_CONFLICT');
    return { fetcher: proxiedDigestFetcher(proxy), transport: 'http_proxy' };
  }
  if (!endpoint && !secret) return { fetcher: fetchDigestImage, transport: 'network' };
  if (!endpoint || !publicDigestUrl(endpoint) || !secret || secret.length < 32) throw new Error('MEDIA_RELAY_CONFIGURATION');
  const u = new URL(endpoint);
  if (u.pathname !== '/fetch' || u.search || u.hash || u.port) throw new Error('MEDIA_RELAY_CONFIGURATION');
  return { transport: 'cloudflare_worker', fetcher: async (input, options) => {
    const url = String(input); const expires = Math.floor(Date.now() / 1000) + 60;
    const signature = await relaySignature(secret, url, expires);
    return fetch(endpoint, { method: 'POST', redirect: 'error', signal: options?.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, expires, signature }) });
  } };
}
