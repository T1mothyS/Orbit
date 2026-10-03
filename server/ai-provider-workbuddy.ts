import { query, createSdkMcpServer, tool, type UserMessage, type Options } from '@tencent-ai/agent-sdk';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ORBIT_AI_QUERY_POLICY } from './orbit-ai-policy.js';
import { resolveCodeBuddyCredential } from './ai-credentials.js';
import { buildCodeBuddyEnv } from './codebuddy-env.js';
import { extractAiMessageText, parseAiJsonCandidates } from './ai-json.js';
import { ORBIT_TOOL_LIMITS, type AiProvider, type ProviderRequest } from './ai-provider-contract.js';
export function isOrbitToolAllowed(name:string,names:string[]):boolean {return names.includes(name);}
export function workBuddyOptions(request:ProviderRequest) {
  const names=(request.tools||[]).map(t=>`mcp__orbit__${t.name}`);
  let calls=0;
  const definitions=(request.tools||[]).map(t=>tool(t.name,t.description,{args:z.string().max(12000).describe('JSON object conforming to: '+JSON.stringify(t.schema))},async({args})=>{
    request.controller?.signal.throwIfAborted();
    if(++calls>ORBIT_TOOL_LIMITS.calls) return {isError:true,content:[{type:'text' as const,text:'工具调用次数已达到本轮上限，请基于已有资料回答。'}]};
    try {const value=await t.execute(JSON.parse(args),request.controller?.signal);return {content:[{type:'text' as const,text:JSON.stringify(value)}]};}
    catch(error){return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:'工具调用失败'}]};}
  }));
  return {...ORBIT_AI_QUERY_POLICY,cwd:process.cwd(),model:request.model,systemPrompt:request.instructions,abortController:request.controller,
    maxTurns:definitions.length?ORBIT_TOOL_LIMITS.rounds:1,strictMcpConfig:true,
    mcpServers:(definitions.length?{orbit:createSdkMcpServer({name:'orbit',tools:definitions})}:{}) as Options['mcpServers'],allowedTools:names,
    canUseTool:async(name:string)=>isOrbitToolAllowed(name,names)?{behavior:'allow' as const}:{behavior:'deny' as const,message:'仅允许调用 Orbit 注册工具'},
  };
}
async function* prompt(request:ProviderRequest):AsyncGenerator<UserMessage> {
  yield {type:'user',uuid:randomUUID(),session_id:randomUUID(),parent_tool_use_id:null,message:{role:'user',content:request.input.map(p=>p.type==='image'?{type:'image' as const,source:{type:'base64' as const,media_type:p.mime as 'image/jpeg'|'image/png'|'image/webp',data:p.data!}}:{type:'text' as const,text:p.text||''})}};
}
export const workBuddyProvider:AiProvider={id:'workbuddy',async generate(request){
  const credential=resolveCodeBuddyCredential(request.userId);if(!credential)throw new Error('请先配置 WorkBuddy API Key');
  let assistant='',result='';
  for await(const msg of query({prompt:request.input.some(p=>p.type==='image')?prompt(request):request.input.map(p=>p.text||'').join('\n'),options:{...workBuddyOptions(request),env:buildCodeBuddyEnv(credential)}})) {
    request.controller?.signal.throwIfAborted();
    if(msg.type==='assistant'){const text=extractAiMessageText(msg);if(text)assistant=text;}
    else if(msg.type==='result')result=extractAiMessageText(msg);
  }
  // A final result takes precedence over intermediate assistant text from tool rounds.
  try{return JSON.stringify(parseAiJsonCandidates([result,assistant]).value);}catch{return result||assistant;}
}};
