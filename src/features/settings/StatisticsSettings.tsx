import { useEffect,useState } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import { Button,Select,Tabs,TextLink } from '../../ui';
import { DEFAULT_STATISTICS_FILTERS,parseStatisticsFilters,type StatisticsFilters } from '../../utils/statistics-filters';
import { SettingRow,SettingSection } from './SettingFields';
import { settingsCategories } from './navigation';
import { useSettingsActive,useSettingsDirty,useSettingsRequest } from './SettingsState';

export function StatisticsSettings() {
  const location=useLocation(),navigate=useNavigate(),active=useSettingsActive(),request=useSettingsRequest();
  const history=location.pathname.endsWith('/history');
  const [saved,setSaved]=useState<StatisticsFilters|null>(null),[draft,setDraft]=useState<StatisticsFilters>({...DEFAULT_STATISTICS_FILTERS});
  const [reports,setReports]=useState<Array<{id:string;rangeStart:string;rangeEnd:string}>>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const dirty=!!saved&&JSON.stringify(saved)!==JSON.stringify(draft);
  useSettingsDirty('statistics',dirty);
  useEffect(()=>{
    if(!active)return;
    let alive=true;
    const load=async()=>{setError('');try{
      if(history){const r=await request('/api/orbit/activity-reports');const d=await r.json();if(!r.ok)throw new Error(d.error||'报告列表读取失败');if(alive){setReports(d.reports||[]);setLoaded(true);}}
      else {const r=await request('/api/orbit/preferences');const d=await r.json();if(!r.ok)throw new Error(d.error||'统计偏好读取失败');const value=parseStatisticsFilters(d.statisticsFilters||DEFAULT_STATISTICS_FILTERS);if(alive){setSaved(value);if(!dirty)setDraft(value);}}
    }catch(e){if(alive&&!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:'读取失败');}};
    void load();return()=>{alive=false;};
  },[active,history,retry,request]);
  const save=async()=>{setBusy(true);setError('');setNotice('');try{
    const r=await request('/api/orbit/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({statisticsFilters:draft})});const d=await r.json();if(!r.ok)throw new Error(d.error||'保存失败');setSaved({...draft});setNotice('默认筛选已保存');
  }catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}};
  const tabs=settingsCategories.find(item=>item.id==='statistics')!.children!;
  return <><Tabs label="使用统计设置分类" value={history?'history':'filters'} onValueChange={value=>navigate(tabs.find(item=>item.id===value)!.to,{state:location.state})} items={tabs.map(item=>({value:item.id,label:item.title,content:item.id==='history'?<SettingSection id="statistics-history" title="已保存报告" description="打开历史报告会查看当时的冻结快照，不改变当前默认筛选。列表使用设备时区，结束时刻不包含在范围内。">
    {!loaded&&!error?<p role="status">正在读取报告…</p>:reports.length?<ul className="statistics-saved-list">{reports.map(report=><li key={report.id}><TextLink to={'/project?view=statistics&report='+encodeURIComponent(report.id)}>{new Date(report.rangeStart).toLocaleString()} — {new Date(report.rangeEnd).toLocaleString()}</TextLink></li>)}</ul>:loaded?<p>还没有已保存的报告。</p>:null}
  </SettingSection>:<SettingSection id="statistics" title="默认筛选" description="用于实时个人活动报告。自动周报仍统计全部数据，已保存报告保持原有筛选。">
    {!saved?<p role="status">正在读取统计偏好…</p>:<><SettingRow id="statistics-filters" label="事项类型"><Select label="默认事项类型" disabled={busy} value={draft.taskType} onValueChange={value=>{setDraft({...draft,taskType:value as StatisticsFilters['taskType']});setNotice('');}} options={[{value:'all',label:'全部事项'},{value:'event',label:'日程'},{value:'todo',label:'待办'},{value:'reminder',label:'周期事项'}]}/></SettingRow>
    <SettingRow label="日报来源"><Select label="默认日报来源" disabled={busy} value={draft.reportSource} onValueChange={value=>{setDraft({...draft,reportSource:value as StatisticsFilters['reportSource']});setNotice('');}} options={[{value:'all',label:'全部来源'},{value:'local',label:'Local'},{value:'cloud',label:'Cloud'}]}/></SettingRow>
    <div className="settings-inline-actions"><Button variant="primary" disabled={!dirty||busy} onClick={()=>void save()}>{busy?'保存中…':'保存默认筛选'}</Button><Button disabled={!dirty||busy} onClick={()=>{setDraft({...saved});setNotice('');}}>取消</Button><TextLink to="/project?view=statistics">查看个人活动报告</TextLink></div></>}
  </SettingSection>}))}/>{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error} <Button onClick={()=>setRetry(v=>v+1)}>重新读取</Button></p>}</>;
}
