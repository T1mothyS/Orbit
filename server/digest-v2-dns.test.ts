import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupDigestProxyDns} from './digest-v2-dns.js';
import {assertPublicUpstreamUrl} from './daily-report-media-service.js';
import {proxiedDigestFetcher} from './digest-v2-fetch.js';

const answer = (address = '104.20.17.1') => ({Status:0,TC:false,Question:[{name:'api.openverse.org.',type:1}],Answer:[{name:'api.openverse.org.',type:1,data:address}]});
const response = (data: unknown) => new Response(JSON.stringify(data),{headers:{'content-type':'application/dns-json'}});
test('encrypted media DNS checks the fixed endpoint and preserves public IP pinning',async()=>{
  const lookup = async(host:string)=>lookupDigestProxyDns(host,async(url,init)=>{
    assert.equal(String(url),'https://cloudflare-dns.com/dns-query?name=api.openverse.org&type=A');
    assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('accept'),'application/dns-json');
    assert.ok(init?.signal);return response(answer());
  });
  assert.equal((await assertPublicUpstreamUrl('https://api.openverse.org/v1/images/',lookup)).hostname,'api.openverse.org');
  assert.deepEqual(await lookup('api.openverse.org'),[{address:'104.20.17.1',family:4}]);
});
test('encrypted answers cannot authorize loopback, private or mixed public/private destinations',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1']){
    const data=answer();data.Answer.push({...data.Answer[0],data:ip});
    await assert.rejects(assertPublicUpstreamUrl('https://api.openverse.org/',h=>lookupDigestProxyDns(h,async()=>response(data))));
  }
});
test('DNS errors, mismatched questions, redirects, invalid addresses and oversized bodies fail closed',async()=>{
  for(const data of [{...answer(),Status:3},{...answer(),TC:true},{...answer(),Question:[{name:'other.example',type:1}]},{...answer(),Answer:[]},answer('not-an-ip'),{...answer(),Answer:Array(33).fill(answer().Answer[0])}]){
    await assert.rejects(lookupDigestProxyDns('api.openverse.org',async()=>response(data)));
  }
  for(const r of [new Response('',{status:302}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response('x'.repeat(65537),{headers:{'content-type':'application/dns-json'}})]){
    await assert.rejects(lookupDigestProxyDns('api.openverse.org',async()=>r));
  }
  let calls=0;await assert.rejects(lookupDigestProxyDns('api.openverse.org',async()=>{calls++;throw Error('resolver unavailable');}));assert.equal(calls,1);
});
test('caller cancellation is propagated and explicit DNS mode is validated',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(lookupDigestProxyDns('api.openverse.org',async(_url,options)=>{options?.signal?.throwIfAborted();return response(answer());},controller.signal));
  const previous=process.env.DIGEST_MEDIA_DNS_MODE;
  try{process.env.DIGEST_MEDIA_DNS_MODE='unknown';assert.throws(()=>proxiedDigestFetcher('http://127.0.0.1:17898'),/MEDIA_DNS_CONFIGURATION/);}
  finally{if(previous===undefined)delete process.env.DIGEST_MEDIA_DNS_MODE;else process.env.DIGEST_MEDIA_DNS_MODE=previous;}
  assert.deepEqual(await lookupDigestProxyDns('1.1.1.1',async()=>{throw Error('literal DNS unnecessary');}),[{address:'1.1.1.1',family:4}]);
});
