import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import jwt from 'jsonwebtoken';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-chatgpt-'));
Object.assign(process.env,{DATA_DIR:root,NODE_ENV:'test',APP_ENV:'development',BACKGROUND_JOBS_ENABLED:'false',ORBIT_PROACTIVE_ENABLED:'false',BACKUP_ENCRYPTION_KEY:'synthetic'});
const api=await import('./index.js');await api.initializeServer();
const oauth=await import('./chatgpt-oauth.js'),connection=await import('./chatgpt-connection.js'),vault=await import('./orbit-credential-vault.js'),provider=await import('./ai-provider-chatgpt.js'),db=await import('./db.js');
const stamp=new Date().toISOString();for(const [id,role] of [['chatgpt-owner','admin'],['chatgpt-other','user']] as const)db.createUser({id,email:id+'@example.invalid',password_hash:'synthetic',role,disabled:0,created_at:stamp,updated_at:stamp});
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'synthetic',use:'sig'};
const sign=(aud:string,extra:any={})=>jwt.sign({sub:'subject',...extra},privateKey,{algorithm:'RS256',keyid:'synthetic',issuer:oauth.CHATGPT_ISSUER,audience:aud,expiresIn:3600});
const jwks:typeof fetch=async()=>Response.json({keys:[jwk]});
function credential(){return {client_id:'oaiapp_synthetic',issuer:oauth.CHATGPT_ISSUER,subject:'subject',email:'synthetic@example.invalid',id_token:sign('oaiapp_synthetic',{nonce:'n'}),access_token:sign(oauth.CHATGPT_RESOURCE,{client_id:'oaiapp_synthetic',scope:oauth.CHATGPT_SCOPES}),refresh_token:'synthetic-refresh',scopes:oauth.CHATGPT_SCOPES.split(' '),expires_at:Date.now()+3600000,ext_agent_host_id:'urn:uuid:local-test',nonce:'n'};}
test('ID token signature, audience, nonce and scopes are enforced before import; server keeps its host',async()=>{
  const c=credential();await assert.rejects(oauth.verifyOpenAIToken(c.id_token,'other','n',jwks),/audience/);await assert.rejects(oauth.verifyOpenAIToken(c.id_token,c.client_id,'wrong',jwks),/nonce/);
  await assert.rejects(connection.importChatGPTCredential('chatgpt-other',c,jwks),/主账号/);
  const local=connection.hostId();await connection.importChatGPTCredential('chatgpt-owner',c,jwks);assert.equal(vault.loadSecret<any>('chatgpt','chatgpt-owner').ext_agent_host_id,local);assert.notEqual(local,c.ext_agent_host_id);assert.equal(connection.chatGPTStatus('chatgpt-owner').connected,true);assert.ok(!JSON.stringify(connection.chatGPTStatus('chatgpt-owner')).includes('synthetic-refresh'));
  await assert.rejects(connection.importChatGPTCredential('chatgpt-owner',{...c,access_token:sign(oauth.CHATGPT_RESOURCE,{client_id:c.client_id,scope:'openid profile email'})},jwks),/仅登录/);
});
test('loopback callback checks state, saves issued ID, uses PKCE and exact redirect before validating token',async()=>{
  let parameters:URLSearchParams;
  let nonce='';const fake:typeof fetch=async(url,options)=>{if(String(url).endsWith('/jwks.json'))return Response.json({keys:[jwk]});parameters=new URLSearchParams(String(options?.body));return Response.json({token_type:'Bearer',access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,scope:oauth.CHATGPT_SCOPES,id_token:sign('oaiapp_loopback',{nonce})});};
  const auth=await oauth.beginLocalChatGPTAuth('urn:uuid:loopback',undefined,fake),url=new URL(auth.url);nonce=url.searchParams.get('nonce')!;const callback=url.searchParams.get('redirect_uri')!;
  assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(new URL(callback).hostname,'127.0.0.1');
  assert.equal((await fetch(callback+'?state=wrong&code=bad&client_id=oaiapp_loopback')).status,400);
  const request=fetch(callback+'?'+new URLSearchParams({state:url.searchParams.get('state')!,code:'synthetic',client_id:'oaiapp_loopback'}));const c=await auth.result;assert.equal((await request).status,200);assert.equal(c.client_id,'oaiapp_loopback');assert.equal(parameters!.get('redirect_uri'),callback);assert.equal(parameters!.get('client_id'),'oaiapp_loopback');assert.ok(parameters!.get('code_verifier'));
});
test('parallel refresh is serialized; replacement saved; temporary failures preserve credentials',async()=>{
  const c=credential();c.expires_at=Date.now()-1;vault.saveSecret('chatgpt','chatgpt-owner',c);let calls=0;
  const fake:typeof fetch=async(_url,options)=>{calls++;const body=new URLSearchParams(String(options?.body));assert.equal(body.get('client_id'),c.client_id);assert.equal(body.has('scope'),false);await new Promise(r=>setTimeout(r,10));return Response.json({token_type:'Bearer',access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:3600,scope:oauth.CHATGPT_SCOPES,earliest_refresh_at:Date.now()/1000+300});};
  assert.deepEqual(await Promise.all([connection.chatGPTAccessToken('chatgpt-owner',fake),connection.chatGPTAccessToken('chatgpt-owner',fake)]),['rotated-access','rotated-access']);assert.equal(calls,1);assert.equal(vault.loadSecret<any>('chatgpt','chatgpt-owner').refresh_token,'rotated-refresh');
  vault.saveSecret('chatgpt','chatgpt-owner',c);await assert.rejects(connection.chatGPTAccessToken('chatgpt-owner',async()=>Response.json({error:'temporary'},{status:503})),/保留/);assert.equal(vault.loadSecret<any>('chatgpt','chatgpt-owner').refresh_token,c.refresh_token);
  await assert.rejects(connection.chatGPTAccessToken('chatgpt-owner',async()=>Response.json({error:'invalid_grant'},{status:400})),/刷新失败/);assert.equal(connection.chatGPTStatus('chatgpt-owner').connected,false);
});
const sse=(output:any[])=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
test('Responses uses public streaming stateless contract, namespaced tools and sends tool outputs with history',async()=>{
  const reasoning={id:'reasoning-test',type:'reasoning',summary:[],encrypted_content:'opaque-synthetic-content'};
  let n=0;const bodies:any[]=[];const fake:typeof fetch=async(url,options)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');const b=JSON.parse(String(options?.body));bodies.push(b);assert.equal(b.store,false);assert.equal(b.stream,true);for(const key of ['background','temperature','previous_response_id','max_output_tokens'])assert.equal(key in b,false);assert.equal(b.tools[0].type,'namespace');return ++n===1?sse([reasoning,{type:'function_call',namespace:'orbit',name:'calendar',arguments:'{"date":"2026-10-04"}',call_id:'call'}]):sse([{type:'message',content:[{type:'output_text',text:'{"reply":"done","operations":[]}'}]}]);};
  const text=await provider.generateChatGPT({userId:'x',model:'account-model',instructions:'test',input:[{type:'text',text:'query'}],tools:[{name:'calendar',description:'query',schema:{type:'object'},execute:async()=>({owned:true})}]},'synthetic',fake);assert.equal(JSON.parse(text).reply,'done');assert.equal(n,2);assert.ok(bodies[1].input.some((i:any)=>i.type==='function_call_output'));assert.deepEqual(bodies[1].input.find((i:any)=>i.type==='reasoning'),reasoning);assert.ok(!text.includes(reasoning.encrypted_content));
  await assert.rejects(provider.completedResponse(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')),/未收到完成/);
  await assert.rejects(provider.completedResponse(new Response('data: {"type":"error"}\n\n')),/失败/);
});
test('disconnect retains registration, clears all tokens, and reports unconfirmed remote revocation',async()=>{
  vault.saveSecret('chatgpt','chatgpt-owner',credential());const result=await connection.disconnectChatGPT('chatgpt-owner',async()=>{throw new Error('synthetic network failure');});assert.equal(result.revoked,false);const saved=vault.loadSecret<any>('chatgpt','chatgpt-owner');assert.equal(saved.client_id,'oaiapp_synthetic');assert.equal(saved.access_token,undefined);assert.equal(saved.refresh_token,undefined);assert.equal(saved.id_token,undefined);
});

test('plan-usage SSE retains done output items when the terminal envelope omits them',async()=>{
  const reasoning={id:'reasoning-done',type:'reasoning',summary:[],encrypted_content:'opaque-synthetic-only'};
  const call={type:'function_call',namespace:'orbit',name:'echo',arguments:'{}',call_id:'done-call'};
  const message={type:'message',content:[{type:'output_text',text:'ORBIT_CHATGPT_TEST_OK'}]};
  const stream=(items:any[])=>new Response(items.map(item=>'data: '+JSON.stringify(item)+'\r\n\r\n').join(''));
  const result=await provider.completedResponse(stream([
    {type:'response.output_item.done',output_index:2,item:message},
    {type:'response.output_item.done',output_index:0,item:reasoning},
    {type:'response.output_item.done',output_index:1,item:call},
    {type:'response.completed',response:{status:'completed',output:[]}},
  ]));
  assert.deepEqual(result.output,[reasoning,call,message]);
  let n=0,calls=0;
  const fake:typeof fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));if(++n===2)assert.deepEqual(body.input.find((item:any)=>item.type==='reasoning'),reasoning);return stream([
    ...(++calls===1?[{type:'response.output_item.done',output_index:0,item:reasoning},{type:'response.output_item.done',output_index:1,item:call}]:[{type:'response.output_item.done',output_index:0,item:message}]),
    {type:'response.completed',response:{status:'completed',output:[]}},
  ]);};
  let executions=0;const text=await provider.generateChatGPT({userId:'x',model:'test',instructions:'test',input:[{type:'text',text:'test'}],tools:[{name:'echo',description:'echo',schema:{type:'object'},execute:async()=>{executions++;return 'synthetic';}}]},'synthetic',fake);
  assert.equal(text,'ORBIT_CHATGPT_TEST_OK');assert.equal(executions,1);assert.equal(n,2);
});

test('done output alone cannot turn interrupted, failed or incomplete streams into success',async()=>{
  const done='data: '+JSON.stringify({type:'response.output_item.done',output_index:0,item:{type:'message',content:[{type:'output_text',text:'partial'}]}})+'\n\n';
  await assert.rejects(provider.completedResponse(new Response(done)),/未收到完成/);
  for(const type of ['response.failed','response.incomplete','error'])await assert.rejects(provider.completedResponse(new Response(done+'data: '+JSON.stringify({type})+'\n\n')),/失败|未完成/);
});
