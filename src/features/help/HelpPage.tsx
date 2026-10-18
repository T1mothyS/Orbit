import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Section, TextLink } from '../../ui';
import { helpTopics } from './topics';
import './help.css';
export default function HelpPage() {
  const location = useLocation(), navigate = useNavigate();
  const requested = (location.state as { helpReturnTo?: unknown } | null)?.helpReturnTo;
  let returnTo = '/assistant';
  if (typeof requested === 'string') { try { const url = new URL(requested, window.location.origin); if (url.origin === window.location.origin && url.pathname === '/assistant') returnTo = url.pathname + url.search; } catch { /* Use the main conversation. */ } }
  return <article className="oui-root orbit-help-page"><header><h1>Orbit 使用指南</h1><p>从常用任务开始，按需要调整你的个人事务中心。</p></header>
    <p className="oui-help">“询问 AI”会把固定问题补到对话草稿末尾，保留已有文字和图片；由你检查后发送。</p>
    {helpTopics.map(topic => <Section key={topic.id} title={topic.title} description={topic.description}><div className="orbit-help-actions"><TextLink to={topic.to}>{topic.action}</TextLink><Button variant="quiet" onClick={() => navigate(returnTo, { state: { helpQuestion: topic.id } })}>询问 AI：{topic.title}</Button></div></Section>)}
    <footer><TextLink to={returnTo}>返回对话</TextLink><p className="oui-help">实际连接、权限和投递结果以对应页面及运行记录为准。</p></footer>
  </article>;
}
