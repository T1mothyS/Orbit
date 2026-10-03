import { useCallback, useEffect, useRef, useState } from 'react';
import { initialModel, type AiProvider, type AiSelection, type SelectableModel } from '../utils/ai-selection';

interface ProviderStatus { id: AiProvider; connected: boolean }
export function useAiSelection(authHeaders: () => Record<string, string>, authenticated: boolean) {
  const [selection, setSelection] = useState<AiSelection>({ provider: 'workbuddy', models: {} });
  const current = useRef(selection);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<SelectableModel[]>([]);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [saveError, setSaveError] = useState('');
  const revision = useRef(0), writing = useRef(false);
  const pendingWrite = useRef<Promise<unknown> | null>(null);
  const api = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || '模型设置暂时不可用');
    return data;
  }, [authHeaders]);
  const update = (value: AiSelection) => { current.current = value; setSelection(value); };
  const persist = useCallback(async (value: AiSelection, epoch: number) => {
    writing.current = true; setSaving(true); setSaveError('');
    const operation = api('/api/orbit/preferences', { aiSelection: value });
    pendingWrite.current = operation;
    try { await operation; }
    catch { if (epoch === revision.current) setSaveError('模型偏好未保存，本次选择仍可使用。请重试保存。'); }
    finally { if (pendingWrite.current === operation) pendingWrite.current = null; if (epoch === revision.current) { writing.current = false; setSaving(false); } }
  }, [api]);
  const loadCatalog = useCallback(async (value: AiSelection, statuses: ProviderStatus[], epoch: number) => {
    setModels([]); setError(''); setSaveError('');
    if (!statuses.find(item => item.id === value.provider)?.connected) { setError(`${value.provider === 'chatgpt' ? 'ChatGPT' : 'Work Buddy'} 尚未连接，请在设置中连接后重试。`); return; }
    const data = await api(value.provider === 'chatgpt' ? '/api/orbit/chatgpt/models' : '/api/models');
    const defaultModel = value.provider === 'workbuddy' && !value.models.workbuddy ? (await api('/api/schedule-model')).model : undefined;
    if (epoch !== revision.current) return;
    const catalog: SelectableModel[] = (data.models || []).map((model: { id?: string; modelId?: string; name?: string; displayName?: string }) => ({ id: model.id || model.modelId || '', name: model.name || model.displayName || model.id || model.modelId || '' })).filter((model: SelectableModel) => model.id);
    setModels(catalog);
    const id = initialModel(value.provider, catalog, value.models[value.provider], defaultModel);
    const next = { ...value, models: { ...value.models, ...(id ? { [value.provider]: id } : {}) } };
    update(next);
    if (!catalog.length) { setError('当前账号暂未提供可用模型，请重试。'); return; }
    if (id && !catalog.some(model => model.id === id)) { setError('上次使用的模型目前不可用，请选择可用模型。'); return; }
    if (!id) { setError('当前目录没有 Luna，请在模型设置中选择具体模型。'); return; }
    await persist(next, epoch);
  }, [api, persist]);
  const initialize = useCallback(async () => {
    const epoch = ++revision.current;
    setLoading(true); setError(''); setSaveError(''); setModels([]);
    try {
      // A connection update must read preferences after an in-flight explicit choice has settled.
      await pendingWrite.current?.catch(() => undefined);
      if (epoch !== revision.current) return;
      writing.current = false; setSaving(false);
      const [preferences, status] = await Promise.all([api('/api/orbit/preferences'), api('/api/orbit/providers')]);
      if (epoch !== revision.current) return;
      const statuses: ProviderStatus[] = status.providers || []; setProviders(statuses);
      const value: AiSelection = preferences.aiSelection || { provider: statuses.some(item => item.id === 'chatgpt' && item.connected) ? 'chatgpt' : 'workbuddy', models: {} };
      update(value); await loadCatalog(value, statuses, epoch);
    } catch (cause) { if (epoch === revision.current) setError(cause instanceof Error && cause.name === 'TimeoutError' ? '模型目录读取超时，请重试。' : cause instanceof Error ? cause.message : '模型目录读取失败'); }
    finally { if (epoch === revision.current) setLoading(false); }
  }, [api, loadCatalog]);
  useEffect(() => {
    if (!authenticated) return;
    void initialize(); window.addEventListener('orbit:provider-update', initialize);
    return () => { revision.current++; window.removeEventListener('orbit:provider-update', initialize); };
  }, [authenticated, initialize]);
  const chooseProvider = async (provider: AiProvider) => {
    if (loading || writing.current || provider === current.current.provider) return;
    const epoch = ++revision.current, next = { ...current.current, provider };
    update(next); setLoading(true);
    try { await loadCatalog(next, providers, epoch); }
    catch (cause) { if (epoch === revision.current) setError(cause instanceof Error ? cause.message : '模型目录读取失败'); }
    finally { if (epoch === revision.current) setLoading(false); }
  };
  const chooseModel = async (model: string) => {
    if (loading || writing.current || !models.some(item => item.id === model)) return;
    const next = { ...current.current, models: { ...current.current.models, [current.current.provider]: model } };
    update(next); setError(''); await persist(next, revision.current);
  };
  const retry = async () => {
    if (loading || writing.current) return;
    if (saveError) { await persist(current.current, revision.current); return; }
    const epoch = ++revision.current; setLoading(true);
    try { const status = await api('/api/orbit/providers'); if (epoch !== revision.current) return; setProviders(status.providers); await loadCatalog(current.current, status.providers, epoch); }
    catch (cause) { if (epoch === revision.current) setError(cause instanceof Error ? cause.message : '读取失败，请重试'); }
    finally { if (epoch === revision.current) setLoading(false); }
  };
  const model = selection.models[selection.provider] || '';
  const ready = !loading && !saving && !error && providers.some(item => item.id === selection.provider && item.connected) && models.some(item => item.id === model);
  return { provider: selection.provider, model, models, loading, saving, error, saveError, ready, chooseProvider, chooseModel, retry };
}
