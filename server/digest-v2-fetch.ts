import dns from 'node:dns/promises';
import https from 'node:https';
import { Readable } from 'node:stream';
import { assertPublicUpstreamUrl } from './daily-report-media-service.js';

/** Pin the validated address to the connection, preventing a second DNS lookup/rebinding. */
export const fetchDigestImage: typeof fetch = async (input, options) => {
  let addresses: Awaited<ReturnType<typeof dns.lookup>>[] = [];
  const url = await assertPublicUpstreamUrl(String(input), async hostname => {
    const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = resolved;
    return resolved as Array<{ address: string; family: 4 | 6 }>;
  });
  if (url.protocol !== 'https:') throw new Error('HTTPS_REQUIRED');
  const requestHeaders: Record<string, string> = {};
  new Headers(options?.headers).forEach((value, key) => { requestHeaders[key] = value; });
  return new Promise<Response>((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET', signal: options?.signal || undefined,
      headers: requestHeaders,
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
};
