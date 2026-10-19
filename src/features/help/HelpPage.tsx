import { ReturnToToday } from '../../components/ReturnToToday';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, TextLink } from '../../ui';
import { helpTopics } from './topics';
import { PageFrame } from '../../layouts/PageFrame';
import './help.css';
export default function HelpPage() {
  const location = useLocation(), navigate = useNavigate();
  const requested = (location.state as { helpReturnTo?: unknown } | null)?.helpReturnTo;
  let returnTo = '/assistant';
  if (typeof requested === 'string') { try { const url = new URL(requested, window.location.origin); if (url.origin === window.location.origin && url.pathname === '/assistant') returnTo = url.pathname + url.search; } catch { /* Use the main conversation. */ } }
  return <PageFrame><ReturnToToday/><article className="orbit-help-page"><header><h1>Orbit 使用指南</h1><p>从常用任务开始，按需要调整你的个人事务中心。</p></header>
    <nav className="orbit-help-index" aria-label="指南目录">{helpTopics.map(topic => <a key={topic.id} className="oui-text-link" href={'#help-' + topic.id}>{topic.title}</a>)}</nav>
    <p className="oui-help">“询问 AI”会把固定问题补到对话草稿末尾，保留已有文字和图片；由你检查后发送。</p>
    <div className="orbit-help-topics">{helpTopics.map(topic => <section key={topic.id} id={'help-' + topic.id} aria-labelledby={'help-title-' + topic.id} tabIndex={-1}><div><h2 id={'help-title-' + topic.id}>{topic.title}</h2><p>{topic.description}</p></div><div className="orbit-help-actions"><TextLink to={topic.to}>{topic.action}</TextLink><Button variant="quiet" onClick={() => navigate(returnTo, { state: { helpQuestion: topic.id } })}>询问 AI：{topic.title}</Button></div></section>)}</div>
    <footer><p className="oui-help">实际连接、权限和投递结果以对应页面及运行记录为准。</p></footer>
  </article></PageFrame>;
}
