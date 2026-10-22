import { ReturnToToday } from '../../components/ReturnToToday';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Button, IconLink } from '../../ui';
import { helpTopics } from './topics';
import { PageFrame } from '../../layouts/PageFrame';
import './help.css';
export default function HelpPage() {
  const location = useLocation(), navigate = useNavigate();
  const requested = (location.state as { helpReturnTo?: unknown } | null)?.helpReturnTo;
  let returnTo = '/assistant';
  if (typeof requested === 'string') { try { const url = new URL(requested, window.location.origin); if (url.origin === window.location.origin && url.pathname === '/assistant') returnTo = url.pathname + url.search; } catch { /* Use the main conversation. */ } }
  return <PageFrame><ReturnToToday/><article className="orbit-help-page"><header><h1>Orbit 使用指南</h1><p>从常用任务开始，按需要调整你的个人事务中心。</p></header>
    <div className="orbit-help-topics">{helpTopics.map(topic => <section key={topic.id} id={'help-' + topic.id} aria-labelledby={'help-title-' + topic.id} tabIndex={-1}>
      <header className="orbit-help-topic-heading"><h2 id={'help-title-' + topic.id}>{topic.title}</h2><div className="orbit-help-actions"><IconLink to={topic.to} label={topic.action}><ArrowUpRight size={20} aria-hidden="true" /></IconLink><Button size="small" aria-label={`询问 AI：${topic.title}`} onClick={() => navigate(returnTo, { state: { helpQuestion: topic.id } })}>询问 AI</Button></div></header>
      <p>{topic.description}</p><ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>
    </section>)}</div>
    <footer><p className="oui-help">实际连接、权限和投递结果以对应页面及运行记录为准。</p></footer>
  </article></PageFrame>;
}
