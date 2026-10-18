import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { ButtonLink, EmptyState, ErrorState, LoadingState } from '../ui';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

interface PublicTool {
  slug: string;
  title: string;
  summary: string;
  path: string;
  kind: 'mounted';
}

function isPublicTool(value: unknown): value is PublicTool {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.slug === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.summary === 'string'
    && typeof candidate.path === 'string'
    && candidate.kind === 'mounted';
}

function toolMark(title: string): string {
  const text = title.trim();
  return text.length > 1 ? text.slice(0, 2) : text || 'T';
}

export function ToolsPage() {
  const { authHeaders } = useAuth();
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/tools', {
        headers: authHeaders(),
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => null) as { tools?: unknown; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || '工具清单暂时不可用，请稍后再试');
      if (!Array.isArray(data?.tools)) throw new Error('工具清单格式无效，请稍后再试');
      setTools(data.tools.filter(isPublicTool));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '工具清单暂时不可用，请稍后再试');
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void loadTools(); }, [loadTools, reloadKey]);

  return <section className="oui-root tools-page" aria-labelledby="tools-page-title"><div className="tools-page-inner">
    <header className="tools-page-header"><div><h1 id="tools-page-title">工具中心</h1><p>{loading ? '正在读取个人应用…' : error ? '个人应用与实用工具' : `${tools.length} 个个人应用，选择后在当前页面打开。`}</p></div><ButtonLink to="/today" variant="quiet"><ArrowLeft size={16} aria-hidden="true"/>返回主站</ButtonLink></header>
    {loading ? <LoadingState label="正在读取工具…"/> : error ? <ErrorState title="工具暂时无法加载" description={error} onRetry={() => setReloadKey(value => value + 1)}/> : !tools.length ? <EmptyState title="还没有可用的工具" description="启用的个人应用会显示在这里。"/> : <div className="tools-grid">{tools.map(tool => <article key={tool.slug} className="tools-card" data-tool-slug={tool.slug}><a className="tools-card-link" href={tool.path} aria-label={`打开 ${tool.title}`}><span className="tools-card-mark" aria-hidden="true">{toolMark(tool.title)}</span><div><h2>{tool.title}</h2><p>{tool.summary}</p></div><ArrowUpRight size={18} aria-hidden="true"/></a></article>)}</div>}
  </div></section>;
}
