import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import { Readable } from 'node:stream';
import { assertPublicUpstreamUrl } from './daily-report-media-service.js';

/** Pin the validated address to the connection, preventing a second DNS lookup/rebinding. */
export function digestProxyUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('MEDIA_PROXY_CONFIGURATION');
  return url;
}

/** CONNECT the validated numeric IP; TLS still authenticates the original hostname. */
export function proxiedDigestFetcher(endpoint: string): typeof fetch {
  const proxy = digestProxyUrl(endpoint);
  return async (input, options) => {
    try { return await fetchPinned(input, options, proxy); }
    catch (error: any) {
      if (options?.signal?.aborted || !['ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(error?.code)) throw error;
      // One transient connection retry; every attempt independently validates/pins DNS.
      return fetchPinned(input, options, proxy);
    }
  };
}
export const fetchDigestImage: typeof fetch = (input, options) => fetchPinned(input, options);
async function fetchPinned(input: Parameters<typeof fetch>[0], options: Parameters<typeof fetch>[1], proxy?: URL): Promise<Response> {
  let addresses: Awaited<ReturnType<typeof dns.lookup>>[] = [];
  const url = await assertPublicUpstreamUrl(String(input), async hostname => {
    const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = resolved;
    return resolved as Array<{ address: string; family: 4 | 6 }>;
  });
  if (url.protocol !== 'https:') throw new Error('HTTPS_REQUIRED');
  const requestHeaders: Record<string, string> = {};
  new Headers(options?.headers).forEach((value, key) => { if (['accept', 'user-agent', 'if-none-match', 'if-modified-since'].includes(key)) requestHeaders[key] = value; });
  let agent: https.Agent | undefined;
  if (proxy) {
    const address = addresses.find(a => a.family === 4) || addresses[0];
    const target = `${address.family === 6 ? `[${address.address}]` : address.address}:${url.port || '443'}`;
    const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const connect = http.request({ hostname: proxy.hostname, port: proxy.port, method: 'CONNECT', path: target, headers: { host: target }, signal: options?.signal || undefined });
      connect.setTimeout(12_000, () => connect.destroy(new Error('MEDIA_PROXY_TIMEOUT')));
      connect.once('error', reject);
      connect.once('connect', (response, tunnel, head) => {
        if (response.statusCode !== 200 || head.length) { tunnel.destroy(); reject(new Error('MEDIA_PROXY_CONNECT_FAILED')); return; }
        const secure = tls.connect({ socket: tunnel, servername: url.hostname, rejectUnauthorized: true });
        const abort = () => secure.destroy(new Error('MEDIA_PROXY_ABORTED'));
        options?.signal?.addEventListener('abort', abort, { once: true });
        secure.once('close', () => options?.signal?.removeEventListener('abort', abort));
        secure.setTimeout(12_000, () => secure.destroy(new Error('MEDIA_PROXY_TIMEOUT')));
        secure.once('error', reject);
        secure.once('secureConnect', () => resolve(secure));
        if (options?.signal?.aborted) abort();
      });
      connect.end();
    });
    agent = new https.Agent({ keepAlive: false });
    agent.createConnection = () => socket;
  }
  return new Promise<Response>((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET', signal: options?.signal || undefined,
      headers: requestHeaders, agent,
      lookup: ((_hostname: string, lookupOptions: any, callback: any) => {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      }) as any,
    }, response => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(response.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const status = response.statusCode || 502;
      if ([204, 205, 304].includes(status)) { response.resume(); resolve(new Response(null, { status, headers })); }
      else resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers }));
    });
    request.on('error', reject); request.end();
  });
}
