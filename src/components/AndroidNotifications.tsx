import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { androidCall, isAndroid, syncAndroid } from '../services/android-bridge';
import { getStoredAuthHeaders } from '../hooks/useAuth';

export function AndroidNotifications(){
  const navigate=useNavigate();
  useEffect(()=>{if(!isAndroid())return;let stopped=false,busy=false;
    const sync=async()=>{if(busy||stopped||document.visibilityState==='hidden')return;busy=true;try{const s=await syncAndroid();if(stopped)return;
      if(s.pendingNotification){const response=await fetch(`/api/android-push/notifications/${encodeURIComponent(s.pendingNotification)}`,{headers:getStoredAuthHeaders()});if(response.ok){const value=await response.json();if(typeof value.targetPath==='string'&&/^\/(schedule|reminders|today)(\?|$)/.test(value.targetPath)){await androidCall('consumeNotification',{id:s.pendingNotification});navigate(value.targetPath);}}else if(response.status===404){await androidCall('consumeNotification',{id:s.pendingNotification});}}
    }catch{/* Native status remains visible in Settings; web features remain usable. */}finally{busy=false;}};
    void sync();const timer=setInterval(()=>void sync(),30000);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',sync);
    return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',sync);document.removeEventListener('visibilitychange',sync);};
  },[navigate]);return null;
}
