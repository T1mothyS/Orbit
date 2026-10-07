import {useCallback,useEffect,useState} from 'react';
import {Button,Switch} from 'tdesign-react';
import {SettingRow} from '../SettingRow';
import {androidCall,isAndroid,syncAndroid,type AndroidStatus} from '../../../services/android-bridge';
import {getStoredAuthHeaders} from '../../../hooks/useAuth';

export function AndroidNotificationSettings(){
  const [native,setNative]=useState<AndroidStatus|null>(null),[enabled,setEnabled]=useState(false),[configured,setConfigured]=useState(false),[scanner,setScanner]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{const s=isAndroid()?await androidCall('status'):null;if(s)setNative(s);const r=await fetch('/api/android-push',{headers:getStoredAuthHeaders()}),value=await r.json();if(!r.ok)throw new Error(value.error||'读取 Android 通知失败');setEnabled(value.enabled);setConfigured(value.configured);setScanner(value.scannerEnabled);const last=value.devices?.find((d:{id:string})=>d.id===s?.binding?.id)?.lastTest;if(last)setResult(last.status==='sent'?`FCM：服务端已接受，等待真机观察 · ${new Date(last.createdAt).toLocaleString()}`:`FCM：${last.status}${last.error?' · '+last.error:''}`);},[]);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState!=='hidden')void load().catch(e=>setError(e.message));};refresh();window.addEventListener('focus',refresh);window.addEventListener('orbit:android-state',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('orbit:android-state',refresh);document.removeEventListener('visibilitychange',refresh);};},[load]);
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await load();}catch(e){setError(e instanceof Error?e.message:'通知操作失败');}finally{setBusy(false);}};
  const method=(name:string,params:Record<string,unknown>={})=>act(async()=>{setNative(await androidCall(name,params));});
  return <div aria-label="Android 通知试验">
    <SettingRow label="Android 手机提醒" description="独立账号开关，默认关闭。普通日程和周期事务通过 FCM 发送标题与时间；本地通知仅用于一分钟试验。">
      <Switch aria-label="Android 手机提醒" aria-checked={enabled} value={enabled} disabled={busy} onChange={v=>void act(async()=>{const r=await fetch('/api/android-push/preferences',{method:'PUT',headers:{...getStoredAuthHeaders(),'Content-Type':'application/json'},body:JSON.stringify({enabled:Boolean(v)})});if(!r.ok)throw new Error('手机提醒设置保存失败');})}/>
      {!configured&&<p className="settings-help">服务端 FCM 未配置。</p>}{enabled&&!scanner&&<p className="settings-help">服务端 Push 扫描未启用，真实事项暂不投递。</p>}
    </SettingRow>
    {!isAndroid()?<p className="settings-note">请安装 Orbit Android 客户端后，在这里授权并测试手机通知。</p>:<>
      <SettingRow label="系统权限与注册" description="权限拒绝不会影响登录和聊天。精确测试需要系统的“闹钟和提醒”权限。">
        <p className="settings-help" role="status">通知：{native?.notificationPermission?'已允许':'未允许'} · 精确提醒：{native?.exactAlarmPermission?'已允许':'未允许'}<br/>FCM：{native?.fcmConfigured?native.fcmState:'客户端未配置'} · 设备：{native?.binding?'已绑定':'未绑定'}{native?.pendingRevocations?` · 待补偿解绑 ${native.pendingRevocations} 项`:''}</p>
        <div className="settings-actions"><Button tag="button" disabled={busy} onClick={()=>void method('permission')}>授权系统通知</Button><Button tag="button" variant="outline" disabled={busy} onClick={()=>void method('exactPermission')}>开启闹钟和提醒</Button><Button tag="button" variant="outline" disabled={busy} onClick={()=>void act(async()=>{setNative(await syncAndroid());})}>刷新注册状态</Button></div>
      </SettingRow>
      <SettingRow label="FCM 测试" description="由 Orbit 后端向当前手机发送。发送已接受不等于手机已收到；后台展示及点击结果需要真机确认。">
        <div className="settings-actions"><Button tag="button" disabled={busy||!configured||!native?.fcmConfigured||!native.notificationPermission} onClick={()=>void act(async()=>{const s=await syncAndroid();if(!s.binding)throw new Error('设备未绑定');const r=await fetch(`/api/android-push/devices/${s.binding.id}/test`,{method:'POST',headers:getStoredAuthHeaders()}),d=await r.json();if(!r.ok)throw new Error(d.error||'FCM 测试失败');setResult(d.status==='sent'?'FCM：服务端已接受，等待真机观察':`FCM：${d.status}${d.error?' · '+d.error:''}`);})}>发送 FCM 测试</Button></div>
        <p className="settings-help">{result||'尚未发起服务端测试'} · 手机回调：{native?.fcmResult||'未记录'}</p>
      </SettingRow>
      <SettingRow label="一分钟后本地提醒" description="每台设备只保留一次待触发测试，重新安排会替换旧测试。断网可测试；手机重启和强行停止会影响系统定时。">
        <div className="settings-actions"><Button tag="button" disabled={busy||!native?.notificationPermission||!native.exactAlarmPermission} onClick={()=>void method('scheduleLocal',{exact:true})}>一分钟后本地提醒</Button>{!native?.exactAlarmPermission&&<Button tag="button" variant="outline" disabled={busy||!native?.notificationPermission} onClick={()=>void method('scheduleLocal',{exact:false})}>非精确测试（可能延迟）</Button>}<Button tag="button" variant="outline" disabled={busy||!native?.pendingLocal} onClick={()=>void method('cancelLocal')}>取消本地测试</Button></div>
        <p className="settings-help" role="status">{native?.pendingLocal?`${native.pendingLocal.exact?'精确':'非精确'}测试待触发：${new Date(native.pendingLocal.dueAt).toLocaleTimeString()}`:'没有待触发本地测试'}<br/>{native?.localResult||'本地测试尚无记录'}</p>
      </SettingRow>
    </>}
    {error&&<p className="settings-status" role="alert">{error}</p>}
  </div>;
}
