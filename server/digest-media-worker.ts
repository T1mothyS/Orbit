/** Standalone Cloudflare module Worker. No application imports, credentials or R2 access. */
export interface RelayEnvironment { MEDIA_RELAY_SECRET: string; MEDIA_RELAY_HOSTS: string }
const encoder = new TextEncoder();
export async function relaySignature(secret: string, url: string, expires: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${expires}\n${url}`))), b => b.toString(16).padStart(2, '0')).join('');
}
function allowedUrl(value: string, hosts: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash
      && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)
      && hosts.split(',').map(h => h.trim()).filter(Boolean).includes(u.hostname);
  } catch { return false; }
}
const failure = (status: number, code: string) => new Response(code, { status, headers: { 'cache-control': 'no-store' } });
export async function handleRelay(request: Request, env: RelayEnvironment, upstream: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/fetch') return failure(404, 'NOT_FOUND');
  if (!env.MEDIA_RELAY_SECRET || env.MEDIA_RELAY_SECRET.length < 32 || !env.MEDIA_RELAY_HOSTS) return failure(503, 'NOT_CONFIGURED');
  // Bound the body before parsing, even when Content-Length is absent or dishonest.
  const reader = request.body?.getReader(); if (!reader) return failure(400, 'INVALID_REQUEST');
  let body = ''; let size = 0; const decoder = new TextDecoder();
  try {
    while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 4096) { await reader.cancel(); return failure(413, 'REQUEST_TOO_LARGE'); } body += decoder.decode(r.value, { stream: true }); }
    body += decoder.decode();
  } catch { return failure(400, 'INVALID_REQUEST'); }
  let value: { url: string; expires: number; signature: string };
  try { value = JSON.parse(body); } catch { return failure(400, 'INVALID_REQUEST'); }
  if (!value || typeof value.url !== 'string' || value.url.length > 2048 || !Number.isSafeInteger(value.expires) || typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature)) return failure(400, 'INVALID_REQUEST');
  const now = Math.floor(Date.now() / 1000);
  if (value.expires < now || value.expires > now + 120) return failure(403, 'EXPIRED');
  const expected = await relaySignature(env.MEDIA_RELAY_SECRET, value.url, value.expires);
  let mismatch = 0; for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ value.signature.charCodeAt(i);
  if (mismatch || !allowedUrl(value.url, env.MEDIA_RELAY_HOSTS)) return failure(403, 'NOT_AUTHORIZED');
  try {
    // No cookies, source credentials, request headers or redirects are forwarded.
    const response = await upstream(value.url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'image/*', 'user-agent': 'DailyDigestMedia/1.0' } });
    if (!response.ok) { await response.body?.cancel(); return failure(502, 'SOURCE_HTTP_ERROR'); }
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(mime)) { await response.body?.cancel(); return failure(415, 'SOURCE_NOT_IMAGE'); }
    if (Number(response.headers.get('content-length')) > 5 * 1024 * 1024) { await response.body?.cancel(); return failure(413, 'IMAGE_TOO_LARGE'); }
    const stream = response.body?.getReader(); if (!stream) return failure(502, 'SOURCE_EMPTY');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const r = await stream.read(); if (r.done) break; length += r.value.length; if (length > 5 * 1024 * 1024) { await stream.cancel(); return failure(413, 'IMAGE_TOO_LARGE'); } chunks.push(r.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new Response(bytes, { headers: { 'content-type': mime, 'content-length': String(length), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch { return failure(502, 'SOURCE_UNAVAILABLE'); }
}
export default { fetch: (request: Request, env: RelayEnvironment) => handleRelay(request, env) };
