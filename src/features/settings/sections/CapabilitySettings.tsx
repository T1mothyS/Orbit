import { useState } from 'react';
import { Button,Select } from '../../../ui';
import { SettingRow } from "../SettingFields";
import { useSettingsRequest } from '../SettingsState';
import type { SettingsAuthHeaders } from '../types';
export function CapabilitySettings({ authHeaders }: {
    authHeaders: SettingsAuthHeaders;
}) {
    const settingsFetch = useSettingsRequest();
    const [provider, setProvider] = useState('workbuddy'), [models, setModels] = useState<any[]>([]), [model, setModel] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
    const load = async () => { setBusy(true); setStatus(''); try {
        const res = await settingsFetch(provider === 'chatgpt' ? '/api/orbit/chatgpt/models' : '/api/models', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data.error || '模型读取失败');
        const rows = provider === 'chatgpt' ? data.models : data.models.map((m: any) => m.orbit || { id: m.modelId, name: m.modelName });
        setModels(rows);
        setModel(rows[0]?.id || '');
        if (!rows.length)
            setStatus('当前账号没有可用模型');
    }
    catch (e) {
        setStatus(e instanceof Error ? e.message : '读取失败');
    }
    finally {
        setBusy(false);
    } };
    const probe = async (capability: string) => { setBusy(true); setStatus('正在调用模型验证合成样本…'); try {
        const res = await settingsFetch('/api/orbit/providers/probe', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model, capability }), signal: AbortSignal.timeout(65000) });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data.error);
        setStatus(`${capability === 'images' ? '图片输入' : '工具调用'}已实测通过。刷新模型列表可查看更新。`);
    }
    catch (e) {
        setStatus(e instanceof Error ? e.message : '验证失败，能力仍保持未知');
    }
    finally {
        setBusy(false);
    } };
    return <SettingRow id="ai-model-capabilities" label="模型能力验证" keywords={['vision', '图片', 'tool calling', 'function calling']} description="目录未声明能力时，可手动发送合成图片或空业务工具验证。会消耗所选模型额度，不发送你的日程或文件。"><div className="settings-actions"><Select label="能力验证 Provider" disabled={busy} value={provider} onValueChange={value => {setProvider(value || 'workbuddy');setModels([]);setModel('');}} options={[{value:'workbuddy',label:'WorkBuddy'},{value:'chatgpt',label:'ChatGPT'}]} /><Button disabled={busy} onClick={() => void load()}>读取模型</Button><Select label="能力验证模型" disabled={busy || !models.length} value={model || null} placeholder="先读取模型" onValueChange={value => setModel(value || '')} options={models.map(m=>({value:m.id,label:m.name || m.id}))} /><Button disabled={busy || !model} onClick={() => void probe('images')}>验证图片（调用模型）</Button><Button disabled={busy || !model} onClick={() => void probe('tools')}>验证工具（调用模型）</Button></div><p role="status">{status}</p></SettingRow>;
}
