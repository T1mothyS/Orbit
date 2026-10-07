export interface AndroidStatus {
  version:string; installationId:string; installationKey:string; fid:string|null;
  notificationPermission:boolean; exactAlarmPermission:boolean; fcmConfigured:boolean;
  fcmState:string; binding:{accountId:string;id:string;generation:string}|null;
  pendingLocal:{dueAt:number;exact:boolean}|null; localResult:string; fcmResult:string;
  pendingNotification:string|null; pendingRevocations:number;
}
declare global {interface Window {OrbitNative?:{postMessage(message:string):void;onmessage?:((event:{data:string})=>void)|null}}}
const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
export const isAndroid = () => !!window.OrbitNative;
export function androidCall<T=AndroidStatus>(method:string,params:Record<string,unknown>={}):Promise<T>{
  const bridge=window.OrbitNative;if(!bridge)return Promise.reject(new Error('请在 Orbit Android 客户端中操作'));
  bridge.onmessage=event=>{try{const response=JSON.parse(event.data),request=pending.get(response.id);if(!request)return;clearTimeout(request.timer);pending.delete(response.id);response.error?request.reject(new Error(response.error)):request.resolve(response.result);}catch{/* Ignore malformed bridge replies. */}};
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Android 操作超时，请重试'));},20000);pending.set(id,{resolve,reject,timer});bridge.postMessage(JSON.stringify({version:1,id,method,params}));});
}
let syncing:Promise<AndroidStatus>|undefined;
export function syncAndroid():Promise<AndroidStatus>{
  if(syncing)return syncing;
  syncing=(async()=>{
    const authToken=localStorage.getItem('aicalendar_token');
    const headers={Authorization:`Bearer ${authToken||''}`};
    const me=await fetch('/api/auth/me',{headers});if(!me.ok)throw new Error('请登录后重试');
    const {user}=await me.json();
    if(authToken!==localStorage.getItem('aicalendar_token'))throw new Error('登录状态已变化');
    const status=await androidCall('account',{accountId:user.id});
    const response=await fetch('/api/android-push/devices',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({installationId:status.installationId,installationKey:status.installationKey,fid:status.fid,permission:status.notificationPermission,label:'Orbit Android',version:status.version})});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'设备注册失败');
    try{
      if(authToken!==localStorage.getItem('aicalendar_token'))throw new Error('登录状态已变化');
      return await androidCall('binding',{accountId:user.id,id:value.id,generation:value.generation,fid:status.fid});
    }catch(e){await androidCall('abandonBinding',{id:value.id,generation:value.generation});throw e;}
  })().finally(()=>{syncing=undefined;});return syncing;
}
export function androidLogout(){if(isAndroid())void androidCall('logout').catch(()=>undefined);}
