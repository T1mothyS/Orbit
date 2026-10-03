import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {AiProvider,ProviderRequest} from './ai-provider-contract.js';
/** Explicit, user-triggered synthetic probe. No business data or writes enter the request. */
export async function probeCapability(provider:AiProvider,userId:string,model:string,capability:'images'|'tools',controller:AbortController){
  const nonce=randomUUID();let called=false;
  const request:ProviderRequest={userId,model,controller,instructions:'这是合成能力测试，不执行任何业务操作。',input:[],tools:[]};
  if(capability==='images'){const bytes=await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();request.input=[{type:'text',text:'请只回复图片的主要颜色名称。'},{type:'image',mime:'image/png',data:bytes.toString('base64')}];}
  else {request.input=[{type:'text',text:'必须调用 capability_ping 工具，然后回复工具返回的 nonce。'}];request.tools=[{name:'capability_ping',description:'合成测试，返回 nonce',schema:{type:'object',properties:{},required:[],additionalProperties:false},execute:async()=>{called=true;return {nonce};}}];}
  const result=await provider.generate(request);controller.signal.throwIfAborted();
  if(capability==='images'?!/红|\bred\b/i.test(result):!called||!result.includes(nonce))throw new Error('能力测试未得到可验证结果；仍保持未知状态，可更换模型后重试');
}
