import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Bell, Check, ChevronRight, Copy, HelpCircle, LogOut, Moon, MoreHorizontal, Plus, Search, Settings, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorState, FormField, IconButton, InlineNotice, Input, LoadingState, Menu, PasswordInput, Popover, Section, Select, SettingRow, Sheet, Skeleton, Switch, Tabs, Textarea, ToastProvider, Tooltip, useToast } from '../ui';
import './ui-gallery.css';

export default function UiGallery() { return <ToastProvider><Gallery /></ToastProvider>; }

function Gallery() {
  const { theme, toggleTheme } = useTheme();
  const [search, setSearch] = useSearchParams();
  const view = ['controls', 'surfaces', 'overlays'].includes(search.get('view') || '') ? search.get('view')! : 'controls';
  const [enabled, setEnabled] = useState(true);
  const [checked, setChecked] = useState(true);
  const [selection, setSelection] = useState<string | null>('in-app');
  const [dialog, setDialog] = useState(false), [sheet, setSheet] = useState(false), [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState('personal');
  const [notice, setNotice] = useState('');
  const toast = useToast();
  const views = [{ id: 'controls', title: '控件与表单', description: '主次清楚，反馈明确。' }, { id: 'surfaces', title: '布局与状态', description: '让内容有层级，让状态可理解。' }, { id: 'overlays', title: '浮层与反馈', description: '按任务选择空间，保留操作连续性。' }];
  const current = views.find(item => item.id === view)!;
  return <div className="oui-root gallery" data-ui-gallery="orbit">
    <header className="gallery-topbar"><div className="gallery-brand"><img src="/orbit-logo.png" alt="" /><strong>Orbit</strong><span>界面体系</span></div>
      <div className="gallery-inline"><Badge>开发预览</Badge><Tooltip content={`切换为${theme === 'light' ? '深' : '浅'}色主题`}><IconButton label="切换主题" variant="quiet" onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</IconButton></Tooltip></div>
    </header>
    <div className="gallery-layout"><aside className="gallery-sidebar"><p className="gallery-nav-label">组件与规则</p><nav aria-label="UI Gallery 分类">
      {views.map(item => <Button key={item.id} variant="quiet" aria-current={view === item.id ? 'page' : undefined} onClick={() => setSearch({ view: item.id })}>{item.title}<ChevronRight size={14} /></Button>)}
    </nav><div className="gallery-sidebar-note"><p>清晰、紧凑、从容。</p><p>基础控件的状态与行为，在这里保持一致。</p></div></aside>
    <main className="gallery-main"><div className="gallery-page-heading"><h1>{current.title}</h1><p>{current.description}</p></div>
      {view === 'controls' && <>
        <Section title="操作有主次" description="主要动作保持明确；辅助操作安静，危险动作说明后果。">
          <div className="gallery-demo-row"><span className="gallery-demo-label">常用操作</span><div className="gallery-inline"><Button variant="primary" leadingIcon={<Check size={16} />} onClick={() => toast.show({ title: '预览设置已保存', description: '这是组件示例，没有修改账号数据。' })}>保存修改</Button><Button onClick={() => setNotice('示例修改已取消')}>取消</Button><Button variant="quiet" onClick={() => setNotice('展开了示例说明')}>了解更多<ArrowUpRight size={14} /></Button><IconButton label="添加示例" onClick={() => setNotice('已添加一个示例')}><Plus size={18} /></IconButton></div></div>
          <div className="gallery-demo-row"><span className="gallery-demo-label">状态与边界</span><div className="gallery-inline"><Button variant="primary" loading>保存中…</Button><Button disabled>暂不可用</Button><Button variant="link" onClick={() => setNotice('已打开帮助示例')}>查看使用帮助</Button><Button variant="danger" onClick={() => setConfirm(true)}>撤销示例授权</Button></div></div>
          {notice && <p className="oui-help" role="status">{notice}</p>}
        </Section>
        <Section title="输入保持轻松" description="标签、说明与错误就近呈现，输入内容始终可读。">
          <div className="gallery-form-grid">
            <FormField id="gallery-name" label="显示名称" hint="用于识别你的个人空间。"><Input id="gallery-name" defaultValue="我的 Orbit" aria-describedby="gallery-name-description" /></FormField>
            <FormField id="gallery-password" label="新密码" hint="至少 8 位，支持显示或隐藏。"><PasswordInput id="gallery-password" aria-label="新密码" placeholder="输入新密码" autoComplete="new-password" aria-describedby="gallery-password-description" /></FormField>
            <FormField id="gallery-channel" label="提醒渠道" hint="选择后显示对应渠道的配置。"><Select id="gallery-channel" label="提醒渠道" value={selection} onValueChange={setSelection} describedBy="gallery-channel-description" options={[{ value: 'in-app', label: '站内通知' }, { value: 'email', label: '邮件提醒' }, { value: 'android', label: 'Android 手机推送' }, { value: 'unavailable', label: '暂不可用的渠道', disabled: true }]} /></FormField>
            <FormField id="gallery-error" label="确认密码" error="两次输入不一致，请重新确认。"><Input id="gallery-error" type="password" defaultValue="example" aria-invalid="true" aria-describedby="gallery-error-description" /></FormField>
          </div>
          <div className="gallery-demo-row"><span className="gallery-demo-label">选择与开关</span><div className="gallery-inline gallery-toggle-examples"><label><Checkbox label="接收示例摘要" checked={checked} onCheckedChange={setChecked} /><span>接收摘要</span></label><label><Switch label="示例站内通知" checked={enabled} onCheckedChange={setEnabled} /><span>站内通知</span></label><label><Switch label="不可用示例" checked={false} onCheckedChange={() => undefined} disabled /><span className="oui-muted-text">暂不可用</span></label></div></div>
        </Section>
        <Section title="文字与节奏" description="中文优先，依靠字号、字重和间距建立层级。">
          <div className="gallery-type-specimen"><h3>把今天的事情，安排得更清楚。</h3><p>日程、提醒与记录，在同一个个人空间里有序展开。</p><span>辅助说明 · 当前账号可见</span></div>
          <div className="gallery-token-summary"><span>间距 <strong>4 / 8 / 12 / 16 / 24 / 32</strong></span><span>圆角 <strong>控件 6 · 卡片 8 · 浮层 12</strong></span><span>交互 <strong>短反馈 · 可见焦点 · 降低运动</strong></span></div>
        </Section>
      </>}
      {view === 'surfaces' && <>
        <Section title="设置以内容为中心" description="相关内容归组，状态贴近操作，不把每个字段装进卡片。" action={<Badge tone="success">已保存</Badge>}>
          <SettingRow label="个人空间" description="这个名称仅用于当前账号。" htmlFor="gallery-space"><Input id="gallery-space" defaultValue="我的 Orbit" /><p className="oui-help">下次进入时仍会记住。</p></SettingRow>
          <SettingRow label="站内通知" description="在 Orbit 主对话中接收提醒。"><div className="gallery-inline"><Switch label="布局示例站内通知" checked={enabled} onCheckedChange={setEnabled} /><span>{enabled ? '已开启' : '已关闭'}</span></div><p className="oui-help">示例开关，仅改变当前预览。</p></SettingRow>
          <SettingRow label="长文本与复杂信息" description="较长的邮箱、模型名称和错误信息，也应在自己的区域内自然换行。"><p className="gallery-long-value">long-display-name-for-layout-check@example.invalid</p><div className="gallery-inline"><Badge tone="brand">当前账号</Badge><Badge>仅用于 Cloud 日报</Badge></div></SettingRow>
        </Section>
        <Section title="需要边界时，再使用卡片" description="独立信息块使用一层边框，内容不嵌套卡片。">
          <Card><div className="gallery-card-title"><div><h3>本周记录</h3><p className="oui-help">把重要的进展留在这里。</p></div><Badge tone="neutral">示例</Badge></div><p className="gallery-card-body">完成的事务、积累的知识和新的想法，都可以成为下一步的起点。</p><Button variant="quiet" onClick={() => setNotice('已打开记录示例')}>查看记录<ChevronRight size={15} /></Button></Card>
        </Section>
        <Section title="状态说清下一步" description="加载、失败与空内容有各自的表达，不用一个转圈代替所有情况。">
          <div className="gallery-state-list"><InlineNotice title="设置已保存">下次读取时生效，其他未保存内容仍然保留。</InlineNotice><InlineNotice tone="warning" title="连接暂不可用">设置仍然保留，连接恢复后可以重试。</InlineNotice><ErrorState description="网络连接中断，当前输入仍然保留。" onRetry={() => toast.show({ title: '已重新读取示例设置' })} /><EmptyState title="还没有记录" description="从一条简短的想法开始，稍后也可以继续整理。" actionLabel="添加记录" onAction={() => setNotice('已打开添加记录示例')} /><LoadingState /><Skeleton /></div>
        </Section>
      </>}
      {view === 'overlays' && <>
        <Section title="按任务选择空间" description="简短任务用 Dialog；连续配置用 Sheet，手机优先保留完整操作空间。">
          <div className="gallery-overlay-example"><div><h3>简短编辑</h3><p>当前值、保存和取消，在同一个焦点范围。</p></div><Button onClick={() => setDialog(true)}>打开 Dialog</Button></div>
          <div className="gallery-overlay-example"><div><h3>连续配置</h3><p>独立滚动，标题、返回和主要操作始终可达。</p></div><Button onClick={() => setSheet(true)}>打开 Sheet</Button></div>
          <div className="gallery-overlay-example"><div><h3>就近操作</h3><p>低频动作集中在菜单里，避免占满页面。</p></div><Menu label="示例操作" trigger={<IconButton label="打开示例菜单"><MoreHorizontal size={18} /></IconButton>} items={[{ id: 'copy', label: '复制链接', icon: <Copy size={16} />, onSelect: () => setNotice('已复制示例链接') }, { id: 'settings', label: '打开相关设置', icon: <Settings size={16} />, onSelect: () => setNotice('已打开相关设置示例') }, { id: 'logout', label: '退出示例', icon: <LogOut size={16} />, separatorBefore: true, danger: true, onSelect: () => setConfirm(true) }]} /></div>
          <div className="gallery-overlay-example"><div><h3>补充说明</h3><p>提示解释动作，Popover 承载可阅读的上下文。</p></div><div className="gallery-inline"><Tooltip content="只说明当前动作，不承载必要信息"><IconButton label="查看提示"><HelpCircle size={18} /></IconButton></Tooltip><Popover title="保存方式" trigger={<Button>查看说明</Button>}><p className="oui-help">即时保存的开关会明确标注，其他设置保留自己的保存按钮。</p></Popover></div></div>
        </Section>
        <Section title="反馈不打断操作" description="成功简短确认，错误保留恢复路径。">
          <div className="gallery-inline"><Button leadingIcon={<Check size={16} />} onClick={() => toast.show({ title: '设置已保存', description: '可以继续处理其他事情。' })}>显示成功反馈</Button><Button onClick={() => toast.show({ title: '保存失败，输入已保留', description: '请检查连接后重试。', tone: 'danger' })}>显示错误反馈</Button></div>
          <div className="gallery-feedback-sample"><InlineNotice title="已保存">简短反馈会自动收起；重要错误保留到你处理。</InlineNotice></div>
        </Section>
        <Section title="分类清楚，切换直接"><Tabs label="示例分类" value={tab} onValueChange={setTab} items={[{ value: 'personal', label: '个人资料', content: <p className="oui-help">身份、背景与表达偏好。切换分类不会丢弃当前草稿。</p> }, { value: 'preferences', label: '阅读偏好', content: <p className="oui-help">设置关注主题，保留各领域自己的保存方式。</p> }]} /></Section>
      </>}
      <footer className="gallery-footer"><span>Orbit UI · 基础视觉预览</span><span>示例数据，不连接真实业务</span></footer>
    </main></div>
    <Dialog open={dialog} onOpenChange={setDialog} title="编辑显示名称" description="一个容易辨认的名称，让空间更有归属。" footer={<><Button onClick={() => setDialog(false)}>取消</Button><Button variant="primary" onClick={() => { setDialog(false); toast.show({ title: '示例名称已保存' }); }}>保存名称</Button></>}>
      <FormField id="dialog-name" label="显示名称" hint="只改变本页预览，不会修改账号。"><Input id="dialog-name" defaultValue="我的 Orbit" aria-describedby="dialog-name-description" /></FormField>
    </Dialog>
    <Sheet open={sheet} onOpenChange={setSheet} title="提醒偏好" description="按自己的节奏，选择合适的提醒方式。" footer={<><Button onClick={() => setSheet(false)}>取消</Button><Button variant="primary" onClick={() => { setSheet(false); toast.show({ title: '示例偏好已保存' }); }}>保存偏好</Button></>}>
      <SettingRow label="站内通知" description="在主对话中查看提醒。"><Switch label="Sheet 站内通知" checked={enabled} onCheckedChange={setEnabled} /></SettingRow>
      <SettingRow label="备注" htmlFor="sheet-note" description="较长的说明在内容区内滚动。"><Textarea id="sheet-note" rows={6} placeholder="补充希望记住的事项…" /></SettingRow>
      <InlineNotice tone="warning" title="这是组件预览">保存只更新示例反馈，不创建提醒。</InlineNotice>
    </Sheet>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="撤销示例授权？" description="这是确认组件的示例，不影响任何真实连接。" confirmLabel="撤销示例授权" onConfirm={() => { setConfirm(false); toast.show({ title: '示例授权已撤销' }); }}><p className="oui-help">取消可以继续保留当前状态。</p></ConfirmDialog>
  </div>;
}
