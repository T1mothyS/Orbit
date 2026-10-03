import { chatGPTAccessToken } from './chatgpt-connection.js';
import {withVerifiedCapabilities,capabilityCredentialVersion} from './ai-model-capabilities.js';
import {loadSecret} from './orbit-credential-vault.js';
import type {ChatGPTCredential} from './chatgpt-oauth.js';
import { ORBIT_TOOL_LIMITS,type AiProvider,type OrbitModel,type ProviderRequest } from './ai-provider-contract.js';
const API='https://api.openai.com/v1';
export function chatGPTCapabilityVersion(userId:string){const c=loadSecret<ChatGPTCredential>('chatgpt',userId);return capabilityCredentialVersion((c?.client_id||'')+'\0'+(c?.subject||''));}
export async function chatGPTModels(userId:string,fetcher:typeof fetch=fetch):Promise<OrbitModel[]> {
  const token=await chatGPTAccessToken(userId,fetcher),res=await fetcher(API+'/models',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});if(!res.ok)throw new Error(`无法读取 ChatGPT 模型（${res.status}）`);
  const data=await res.json();return (Array.isArray(data.models)?data.models:[]).filter((m:any)=>m.visibility==='list').map((m:any)=>withVerifiedCapabilities(userId,{id:m.slug,name:m.display_name||m.slug,provider:'chatgpt',capabilities:{images:{supported:Array.isArray(m.input_modalities)?m.input_modalities.includes('image'):null,evidence:Array.isArray(m.input_modalities)?'catalog':'unknown'},tools:{supported:null,evidence:'unknown'},files:{supported:null,evidence:'unknown'}}} as OrbitModel,chatGPTCapabilityVersion(userId)));
}
export async function completedResponse(res:Response):Promise<any> {
  if(!res.ok){await res.body?.cancel();throw new Error(`ChatGPT 调用失败（${res.status}），请检查套餐额度或重新授权`);}
  const reader=res.body?.getReader();if(!reader)throw new Error('ChatGPT 响应为空');
  const decoder=new TextDecoder();let pending='',completed:any,size=0;
  const frame=(part:string)=>{const data=part.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(!data||data==='[DONE]')return;const e=JSON.parse(data);if(e.type==='response.failed'||e.type==='error')throw new Error('ChatGPT 返回失败，请检查额度或授权后重试');if(e.type==='response.incomplete')throw new Error('ChatGPT 回复未完成，请重试');if(e.type==='response.completed'){if(e.response?.status&&e.response.status!=='completed')throw new Error('ChatGPT 回复未完成');completed=e.response;}};
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024)throw new Error('ChatGPT 回复超过限制');pending=(pending+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');let i;while((i=pending.indexOf('\n\n'))>=0){frame(pending.slice(0,i));pending=pending.slice(i+2);}}pending+=decoder.decode();if(pending.trim())frame(pending);}finally{await reader.cancel();}
  if(!completed)throw new Error('ChatGPT 连接已中断，未收到完成状态');return completed;
}
export async function generateChatGPT(request:ProviderRequest,token:string,fetcher:typeof fetch=fetch):Promise<string>{
  const input:any[]=[{role:'user',content:request.input.map(p=>p.type==='image'?{type:'input_image',image_url:`data:${p.mime};base64,${p.data}`} : p.type==='file'?{type:'input_file',filename:p.filename,file_data:`data:${p.mime};base64,${p.data}`}:{type:'input_text',text:p.text||''})}];let calls=0;
  const tools=request.tools||[];
  for(let round=0;round<ORBIT_TOOL_LIMITS.rounds;round++){
    request.controller?.signal.throwIfAborted();
    const res=await fetcher(API+'/responses',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model:request.model,instructions:request.instructions,input,store:false,stream:true,...(tools.length?{tools:[{type:'namespace',name:'orbit',description:'Orbit 受控资料工具；写入仅通过最后的待确认计划',tools:tools.map(t=>({type:'function',name:t.name,description:t.description,parameters:t.schema,strict:true}))}]}:{})}),signal:request.controller?AbortSignal.any([request.controller.signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)});
    const response=await completedResponse(res),output=Array.isArray(response.output)?response.output:[];
    const requested=output.filter((o:any)=>o.type==='function_call');
    if(!requested.length){const text=output.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('\n');if(!text)throw new Error('ChatGPT 未返回可显示的内容');return text;}
    input.push(...output);
    for(const call of requested){
      if(++calls>ORBIT_TOOL_LIMITS.calls)throw new Error('已达到本轮工具调用上限，请缩小问题后重试');
      const tool=tools.find(t=>t.name===call.name&&(call.namespace===undefined||call.namespace==='orbit'));if(!tool)throw new Error('ChatGPT 请求了未授权工具');
      let result:unknown;try{result=await tool.execute(JSON.parse(call.arguments),request.controller?.signal);}catch(e){result={error:e instanceof Error?e.message:'工具失败'};}
      request.controller?.signal.throwIfAborted();input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)});
    }
  }
  throw new Error('本轮处理达到上限，已获得的资料保留在处理步骤中，请缩小问题后重试');
}
export const chatGPTProvider:AiProvider={id:'chatgpt',async generate(request){return generateChatGPT(request,await chatGPTAccessToken(request.userId));}};
