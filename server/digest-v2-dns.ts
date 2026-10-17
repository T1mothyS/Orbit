import net from 'node:net';

/** Fixed HTTPS resolver; callers still validate every returned address and pin CONNECT. */
export async function lookupDigestProxyDns(hostname: string, fetcher: typeof fetch, signal?: AbortSignal | null): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const family = net.isIP(hostname);
  if (family === 4 || family === 6) return [{ address: hostname, family }];
  const timeout = AbortSignal.timeout(5000);
  const response = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error', headers: { accept: 'application/dns-json' },
  });
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/dns-json') || !response.body || Number(response.headers.get('content-length') || 0) > 65536) {
    await response.body?.cancel(); throw Error('MEDIA_DNS_RESPONSE_INVALID');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 65536) throw Error('MEDIA_DNS_RESPONSE_TOO_LARGE'); chunks.push(part.value); }
  } finally { await reader.cancel(); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (data.Status !== 0 || data.TC === true || data.Question?.length !== 1 || data.Question[0].type !== 1 || data.Question[0].name.replace(/\.$/, '').toLowerCase() !== hostname.replace(/\.$/, '').toLowerCase()
      || !Array.isArray(data.Answer) || data.Answer.length > 32) throw Error('MEDIA_DNS_ANSWER_INVALID');
  const answers = data.Answer.filter((row: any) => row.type === 1);
  if (!answers.length || answers.some((row: any) => net.isIP(row.data) !== 4)) throw Error('MEDIA_DNS_ADDRESS_INVALID');
  return answers.map((row: any) => ({ address: row.data, family: 4 as const }));
}
