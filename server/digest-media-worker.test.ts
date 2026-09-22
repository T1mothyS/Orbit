import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRelay, relaySignature } from './digest-media-worker.js';
const env = { MEDIA_RELAY_SECRET: 'a'.repeat(48), MEDIA_RELAY_HOSTS: 'images.example.com' };
async function request(url='https://images.example.com/photo.jpg', expires=Math.floor(Date.now()/1000)+60) {
 return new Request('https://relay.example.com/fetch', {method:'POST', body:JSON.stringify({url,expires,signature:await relaySignature(env.MEDIA_RELAY_SECRET,url,expires)})});
}
test('relay authenticates exact URL and expiry before fetching; no arbitrary host or credentials', async()=>{
 let calls=0;const upstream:typeof fetch=async(_url,init)=>{calls++;assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).get('authorization'),null);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});};
 assert.equal((await handleRelay(await request(),env,upstream)).status,200);assert.equal(calls,1);
 for(const url of ['http://images.example.com/a','https://127.0.0.1/a','https://images.example.com.evil.com/a','https://user:pass@images.example.com/a','https://images.example.com:444/a']) assert.equal((await handleRelay(await request(url),env,upstream)).status,403);
 assert.equal((await handleRelay(await request(undefined,1),env,upstream)).status,403);
 const tampered=await (await request()).json();tampered.url+='changed';
 assert.equal((await handleRelay(new Request('https://relay.example.com/fetch',{method:'POST',body:JSON.stringify(tampered)}),env,upstream)).status,403);
 assert.equal(calls,1);
});
test('relay rejects redirects, HTML, oversized streams, malformed requests and strips response headers',async()=>{
 for(const response of [new Response('',{status:302,headers:{location:'https://private.example.com'}}),new Response('<html/>',{headers:{'content-type':'text/html'}}),new Response(new Uint8Array(5*1024*1024+1),{headers:{'content-type':'image/png'}})]) assert.notEqual((await handleRelay(await request(),env,async()=>response)).status,200);
 assert.equal((await handleRelay(new Request('https://relay.example.com/fetch',{method:'POST',body:'a'.repeat(4097)}),env)).status,413);
 assert.equal((await handleRelay(new Request('https://relay.example.com/fetch',{method:'POST',body:'null'}),env)).status,400);
 const result=await handleRelay(await request(),env,async()=>new Response('png',{headers:{'content-type':'image/png','set-cookie':'secret=value'}}));
 assert.equal(result.headers.get('set-cookie'),null);assert.equal(result.headers.get('cache-control'),'no-store');
 assert.equal((await handleRelay(await request(),env,async()=>{throw new Error('private debug');})).status,502);
});

test('application relay adapter signs server requests, strips source headers and rejects incomplete configuration', async()=>{
 const {digestMediaFetcher}=await import('./digest-v2-relay.js');
 const priorUrl=process.env.DIGEST_MEDIA_RELAY_URL,priorSecret=process.env.DIGEST_MEDIA_RELAY_SECRET,originalFetch=globalThis.fetch;
 try{
  delete process.env.DIGEST_MEDIA_RELAY_URL;delete process.env.DIGEST_MEDIA_RELAY_SECRET;assert.equal(digestMediaFetcher().transport,'network');
  process.env.DIGEST_MEDIA_RELAY_URL='https://relay.example.com/fetch';assert.throws(()=>digestMediaFetcher(),/CONFIGURATION/);
  process.env.DIGEST_MEDIA_RELAY_SECRET=env.MEDIA_RELAY_SECRET;
  let calls=0;globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://relay.example.com/fetch');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('cookie'),null);const body=JSON.parse(String(init?.body));assert.equal(body.signature,await relaySignature(env.MEDIA_RELAY_SECRET,body.url,body.expires));return new Response('png');};
  const adapter=digestMediaFetcher();assert.equal(adapter.transport,'cloudflare_worker');await adapter.fetcher('https://images.example.com/photo.jpg',{headers:{cookie:'not-forwarded'}});assert.equal(calls,1);
  process.env.DIGEST_MEDIA_RELAY_URL='https://relay.example.com/fetch?token=private';assert.throws(()=>digestMediaFetcher(),/CONFIGURATION/);
 }finally{globalThis.fetch=originalFetch;if(priorUrl===undefined)delete process.env.DIGEST_MEDIA_RELAY_URL;else process.env.DIGEST_MEDIA_RELAY_URL=priorUrl;if(priorSecret===undefined)delete process.env.DIGEST_MEDIA_RELAY_SECRET;else process.env.DIGEST_MEDIA_RELAY_SECRET=priorSecret;}
});
