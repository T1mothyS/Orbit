import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ResearchRun {
  id: string; subjectKey: string; subjectTitle: string; question: string;
  status: 'pending' | 'claimed' | 'completed' | 'failed';
  resultBody: string | null; eventRevisionId: string | null; createdAt: string;
}
interface ThesisProposal {
  id: string; runId: string; subjectKey: string; body: string;
  baseVersionId: string | null; status: 'draft' | 'confirmed' | 'rejected';
  createdAt: string;
}
interface ThesisVersion {
  id: string; body: string; confirmedAt: string; previousVersionId: string | null;
}
interface ResearchContext {
  eventTitle: string; revisionNo: number;
  evidence: Array<{ id: string; url: string | null; sourceFact: string; publisherKey: string; reviewState: string; publishedAt: string | null }>;
}

const runStatus: Record<ResearchRun['status'], string> = {
  pending: '待研究', claimed: '研究中', completed: '已完成', failed: '失败',
};
const proposalStatus: Record<ThesisProposal['status'], string> = {
  draft: '待确认草稿', confirmed: '已确认', rejected: '已拒绝',
};
function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}
async function responseError(response: Response): Promise<Error> {
  try { return new Error((await response.json()).error || '研究记录读取失败'); }
  catch { return new Error('研究记录读取失败'); }
}

export function ResearchPage() {
  const { authHeaders } = useAuth();
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [proposals, setProposals] = useState<ThesisProposal[]>([]);
  const [versions, setVersions] = useState<ThesisVersion[]>([]);
  const [context, setContext] = useState<ResearchContext | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runsResponse, proposalsResponse] = await Promise.all([
        fetch('/api/research/runs?limit=100', { headers: authHeaders() }),
        fetch('/api/research/proposals?limit=100', { headers: authHeaders() }),
      ]);
      if (!runsResponse.ok) throw await responseError(runsResponse);
      if (!proposalsResponse.ok) throw await responseError(proposalsResponse);
      setRuns((await runsResponse.json()).runs || []);
      setProposals((await proposalsResponse.json()).proposals || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '研究记录读取失败'); }
    finally { setLoading(false); }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);
  const select = async (proposal: ThesisProposal) => {
    if (selected === proposal.id) { setSelected(null); return; }
    setSelected(proposal.id);
    setVersions([]);
    setContext(null);
    setHistoryReady(false);
    setError(null);
    try {
      const [historyResponse, runResponse] = await Promise.all([
        fetch(`/api/research/theses/${encodeURIComponent(proposal.subjectKey)}`, { headers: authHeaders() }),
        fetch(`/api/research/runs/${encodeURIComponent(proposal.runId)}`, { headers: authHeaders() }),
      ]);
      if (!historyResponse.ok) throw await responseError(historyResponse);
      if (!runResponse.ok) throw await responseError(runResponse);
      setVersions((await historyResponse.json()).versions || []);
      setContext((await runResponse.json()).context || null);
      setHistoryReady(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '观点历史读取失败'); }
  };
  const decide = async (proposal: ThesisProposal, decision: 'confirm' | 'reject') => {
    if (busy || !historyReady || proposal.status !== 'draft') return;
    const action = decision === 'confirm' ? '确认这份观点并写入正式观点历史' : '拒绝这份观点草稿';
    if (!window.confirm(`${action}？`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/proposals/${encodeURIComponent(proposal.id)}/decision`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, expectedBaseVersionId: proposal.baseVersionId, confirm: true }),
      });
      if (!response.ok) throw await responseError(response);
      await load();
      const historyResponse = await fetch(`/api/research/theses/${encodeURIComponent(proposal.subjectKey)}`, { headers: authHeaders() });
      if (!historyResponse.ok) throw await responseError(historyResponse);
      setVersions((await historyResponse.json()).versions || []);
      setHistoryReady(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '观点决定失败'); }
    finally { setBusy(false); }
  };
  const selectedProposal = proposals.find(item => item.id === selected);
  const selectedRun = runs.find(item => item.id === selectedProposal?.runId);

  return (
    <div className="research-page">
      <header className="research-header">
        <div>
          <Link className="research-back" to="/reports"><ArrowLeft size={16} aria-hidden="true" />返回日报</Link>
          <h1>研究与观点</h1>
          <p>研究结果保留为历史记录。建议观点只是草稿，只有你的确认才会形成正式观点。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || busy} className="research-button">
          <RefreshCw size={16} aria-hidden="true" />刷新
        </button>
      </header>
      {error && <div className="research-error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></div>}
      {loading ? <div className="research-state" role="status">正在加载研究记录…</div> : (
        <div className="research-grid">
          <section aria-labelledby="research-history-title">
            <h2 id="research-history-title">研究历史</h2>
            {runs.length === 0 ? <div className="research-state">尚无研究记录。自动研究尚未接入真实 Agent。</div> : (
              <ol className="research-list">
                {runs.map(run => <li key={run.id} className="research-card">
                  <div className="research-card-top"><strong>{run.subjectTitle}</strong><span>{runStatus[run.status]}</span></div>
                  <p>{run.question}</p>
                  {run.resultBody && <div className="research-result">{run.resultBody}</div>}
                  <small>{dateTime(run.createdAt)}{run.eventRevisionId && <> · 事件修订 {run.eventRevisionId}</>}</small>
                </li>)}
              </ol>
            )}
          </section>
          <section aria-labelledby="research-proposals-title">
            <h2 id="research-proposals-title">观点提案</h2>
            {proposals.length === 0 ? <div className="research-state">尚无观点提案。</div> : (
              <ol className="research-list">
                {proposals.map(proposal => <li key={proposal.id} className="research-card">
                  <button type="button" className="research-proposal-open" aria-expanded={selected === proposal.id}
                    onClick={() => void select(proposal)}>
                    <strong>{runs.find(run => run.id === proposal.runId)?.subjectTitle || proposal.subjectKey}</strong>
                    <span>{proposalStatus[proposal.status]}</span>
                  </button>
                  <p>{proposal.body}</p>
                  <small>{dateTime(proposal.createdAt)}</small>
                </li>)}
              </ol>
            )}
          </section>
          {selectedProposal && <section className="research-review" aria-labelledby="research-review-title">
            <h2 id="research-review-title">核对提案</h2>
            <p className="research-review-label">研究问题</p><p>{selectedRun?.question || '原研究记录不可用'}</p>
            <p className="research-review-label">研究结果</p><p>{selectedRun?.resultBody || '暂无结果'}</p>
            <p className="research-review-label">绑定的事件证据</p>
            {context ? <div className="research-evidence">
              <strong>{context.eventTitle} · 第 {context.revisionNo} 版</strong>
              {context.evidence.length === 0 ? <p>该修订没有可显示的来源。</p> : <ul>
                {context.evidence.map(item => <li key={item.id}>
                  {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.publisherKey} · 查看来源</a> : <span>{item.publisherKey} · 来源链接不可用</span>}
                  <span>{item.reviewState === 'verified' ? '已核对' : '需复核'}{item.publishedAt ? ` · ${item.publishedAt}` : ' · 发布时间未知'}</span>
                  <p>{item.sourceFact}</p>
                </li>)}
              </ul>}
            </div> : <p>未绑定 V3 事件证据，请自行核对研究结论。</p>}
            <p className="research-review-label">建议观点</p><p>{selectedProposal.body}</p>
            <p className="research-review-label">已确认观点历史</p>
            {!historyReady ? <p>正在读取观点历史…</p> : versions.length === 0 ? <p>此前尚无已确认观点。</p> : <ol className="research-version-list">
              {versions.map(version => <li key={version.id}><span>{dateTime(version.confirmedAt)}</span><p>{version.body}</p></li>)}
            </ol>}
            {selectedProposal.status === 'draft' && <div className="research-actions">
              <button type="button" disabled={busy || !historyReady} onClick={() => void decide(selectedProposal, 'confirm')} className="research-button primary">确认观点</button>
              <button type="button" disabled={busy || !historyReady} onClick={() => void decide(selectedProposal, 'reject')} className="research-button">拒绝草稿</button>
            </div>}
          </section>}
        </div>
      )}
    </div>
  );
}
