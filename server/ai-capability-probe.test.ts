import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-capabilities-'));const db=await import('./database/connection.js');await db.initDb();
const {probeCapability}=await import('./ai-capability-probe.js'),caps=await import('./ai-model-capabilities.js');
test('image and tool capabilities require verifiable transport results, failures do not claim support',async()=>{
  await probeCapability({id:'workbuddy',generate:async request=>{assert.equal(request.input[1].type,'image');assert.ok(request.input[1].data);return '红色';}},'test','model','images',new AbortController());
  await probeCapability({id:'chatgpt',generate:async request=>{const result=await request.tools![0].execute({});return JSON.stringify(result);}},'test','model','tools',new AbortController());
  await assert.rejects(probeCapability({id:'workbuddy',generate:async()=> '工具不可用'},'test','model','tools',new AbortController()),/未得到/);
});
test('verified capabilities are isolated by owner, model and credential version',()=>{const model:import('./ai-provider-contract.js').OrbitModel={id:'model',name:'Model',provider:'chatgpt',capabilities:{images:{supported:null,evidence:'unknown'},tools:{supported:null,evidence:'unknown'},files:{supported:null,evidence:'unknown'}}};caps.recordVerifiedCapability('owner','chatgpt','model','version','images');assert.equal(caps.withVerifiedCapabilities('owner',model,'version').capabilities.images.evidence,'verified');assert.equal(caps.withVerifiedCapabilities('other',model,'version').capabilities.images.supported,null);assert.equal(caps.withVerifiedCapabilities('owner',model,'changed').capabilities.images.supported,null);});
