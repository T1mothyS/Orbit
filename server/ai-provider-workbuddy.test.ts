import test from 'node:test';
import assert from 'node:assert/strict';
import { workBuddyOptions,isOrbitToolAllowed } from './ai-provider-workbuddy.js';
test('Orbit MCP policy cannot authorize shell, files, WebSearch or inherited MCP',async()=>{
  const options=workBuddyOptions({userId:'synthetic',model:'x',input:[],instructions:'',tools:[{name:'search',description:'search',schema:{},execute:async()=>({})}]});
  for(const name of ['Bash','Read','WebSearch','mcp__other__search','mcp__orbit__unknown'])assert.equal((await options.canUseTool(name)).behavior,'deny');
  assert.equal((await options.canUseTool('mcp__orbit__search')).behavior,'allow');assert.equal(isOrbitToolAllowed('mcp__orbit__search',['mcp__orbit__search']),true);
  assert.deepEqual(options.tools,[]);assert.deepEqual(options.settingSources,[]);assert.equal(options.persistSession,false);assert.equal(options.strictMcpConfig,true);
});
