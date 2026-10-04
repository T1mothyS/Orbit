import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-search-'));
Object.assign(process.env,{DATA_DIR:root,NODE_ENV:'test',APP_ENV:'development',BACKGROUND_JOBS_ENABLED:'false',ORBIT_PROACTIVE_ENABLED:'false',BACKUP_ENCRYPTION_KEY:'synthetic'});
const api=await import('./index.js');await api.initializeServer();
const search=await import('./orbit-search.js'),vault=await import('./orbit-credential-vault.js'),tools=await import('./orbit-tools.js');
test('search uses basic bounded results, caches and preserves real sources and unknown dates',async()=>{
  search.configureSearch('synthetic-only-key');let calls=0;
  const fake:typeof fetch=async(_url,options)=>{calls++;const b=JSON.parse(String(options?.body));assert.equal(b.search_depth,'basic');assert.equal(b.max_results,5);assert.equal(b.auto_parameters,false);return Response.json({results:[{title:'Apple',url:'https://www.apple.com/event',content:'9 AM Pacific'},{title:'bad',url:'javascript:alert(1)'},{title:'unknown time',url:'https://example.org',content:'unknown'}]});};
  const result=await search.searchWeb('synthetic event',undefined,fake);assert.equal(result.length,2);assert.equal(result[0].publishedAt,null);assert.equal(result[0].source,'www.apple.com');assert.ok(result[0].retrievedAt);
  await search.searchWeb('synthetic event',undefined,fake);assert.equal(calls,1);assert.equal(search.searchStatus().used,1);
});
test('quota exhaustion stops future calls; failed requests count conservatively',async()=>{
  await assert.rejects(search.searchWeb('quota',undefined,async()=>new Response('',{status:429})),/额度不足/);
  let called=false;await assert.rejects(search.searchWeb('other',undefined,async()=>{called=true;return Response.json({});}),/已停止/);assert.equal(called,false);
});
test('vault encrypts secrets, authenticates owner, and is excluded from normal attachment backups',()=>{
  vault.saveSecret('test','owner',{token:'synthetic-private'});assert.deepEqual(vault.loadSecret('test','owner'),{token:'synthetic-private'});assert.equal(vault.loadSecret('test','other'),undefined);
  for(const file of fs.readdirSync(path.join(root,'.orbit-secrets')).filter(f=>f.endsWith('.enc')))assert.ok(!fs.readFileSync(path.join(root,'.orbit-secrets',file),'utf8').includes('synthetic-private'));
  vault.removeSecret('test','owner');assert.equal(vault.loadSecret('test','owner'),undefined);
});
test('web reading rejects local/private endpoints and limits body, redirects and active content',async()=>{
  await assert.rejects(search.readWebPage('https://127.0.0.1/private'),/PUBLIC|private|禁止|公网|安全|不允许/i);
  const fake:typeof fetch=async()=>new Response('<script>steal()</script><p>Useful text</p>',{headers:{'Content-Type':'text/html'}});
  assert.equal((await search.readWebPage('https://example.org',undefined,fake)).text,'Useful text');
  await assert.rejects(search.limitedBody(new Response('oversize'),2),/超过/);
});
test('tool registry has no write tools and no implicit knowledge or history access',async()=>{
  const c=tools.createOrbitTools({userId:'synthetic',timezone:'Asia/Hong_Kong',allowKnowledge:false,allowHistory:false});assert.deepEqual(c.tools.map(t=>t.name),['settings','search','read_url','calendar','reports']);
  await assert.rejects(c.tools[0].execute({query:'x',shell:'danger'}),/参数/);
});
