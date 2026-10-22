import { ChartNoAxesCombined,FlaskConical,HelpCircle,LogOut,Mail,Moon,NotebookPen,Settings,Shield,Sun,TrendingUp,Wrench } from 'lucide-react';
import { useLocation,useNavigate } from 'react-router-dom';
import { APP_CONFIG } from '../config';
import { IconButton,Menu,type MenuItem } from '../ui';
import { AccountAvatar } from './AccountAvatar';
import '../styles/account-menu.css';

export function AccountMenu({theme,onToggleTheme,onOpenSettings,onOpenAdmin,user,onLogout}:{theme:string;onToggleTheme:()=>void;onOpenSettings?:()=>void;onOpenAdmin?:()=>void;user?:{email:string;role:'admin'|'user'}|null;onLogout?:()=>void}) {
  const navigate=useNavigate(), location=useLocation();
  const go=(to:string)=>()=>navigate(to,{state:{settingsReturnTo:location.pathname+location.search,helpReturnTo:location.pathname+location.search,importReturnTo:location.pathname+location.search}});
  const items:MenuItem[]=[
    {id:'settings',label:'设置',icon:<Settings size={16}/>,onSelect:onOpenSettings || go('/settings')},
    {id:'statistics',label:'使用统计',icon:<ChartNoAxesCombined size={16}/>,onSelect:go('/project?view=statistics')},
    {id:'theme',label:'切换主题',icon:theme==='light'?<Moon size={16}/>:<Sun size={16}/>,onSelect:onToggleTheme},
    {id:'import',label:'邮箱导入',icon:<Mail size={16}/>,separatorBefore:true,onSelect:go('/import')},
    {id:'experience',label:'记录经历',icon:<NotebookPen size={16}/>,onSelect:go('/library/experience')},
    {id:'research',label:'研究与观点',icon:<FlaskConical size={16}/>,onSelect:go('/research')},{id:'tools',label:'Tools 工具中心',icon:<Wrench size={16}/>,onSelect:go('/tools')},
    {id:'growth',label:'项目成长',icon:<TrendingUp size={16}/>,onSelect:go('/project')},{id:'help',label:'使用指南',icon:<HelpCircle size={16}/>,onSelect:go('/help')},
    ...(user?.role==='admin'?[{id:'admin',label:'管理面板',icon:<Shield size={16}/>,onSelect:()=>onOpenAdmin?.()}]:[]),
    {id:'logout',label:'退出登录',icon:<LogOut size={16}/>,danger:true,separatorBefore:true,onSelect:()=>{onLogout?.();navigate('/login',{replace:true});}},
  ];
  return <Menu navigation label="个人菜单" trigger={<IconButton label="个人菜单" variant="quiet" data-account-menu-trigger title={user?.email}><AccountAvatar email={user?.email||'O'}/></IconButton>} header={<strong>{user?.email}</strong>} footer={'Orbit '+APP_CONFIG.version} items={items}/>;
}
