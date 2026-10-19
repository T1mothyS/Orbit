import { useEffect,useRef,useState } from 'react';
import { Button,FilePicker,Popover } from '../../../ui';
import { SettingRow } from "../SettingFields";
import { useSettingsConfirm } from '../SettingsConfirm';
import { useSettingsRequest } from '../SettingsState';
import type { SettingsAuthHeaders } from '../types';
export function ChatGPTSettings({ authHeaders }: {
    authHeaders: SettingsAuthHeaders;
}) {
    const settingsFetch = useSettingsRequest(), confirm = useSettingsConfirm();
    const [status, setStatus] = useState<any>(), [guide, setGuide] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const api = async (url: string, body?: unknown) => { const r = await settingsFetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) }); const d = await r.json(); if (!r.ok)
        throw new Error(d.error || '操作失败'); if (body !== undefined)
        window.dispatchEvent(new Event('orbit:provider-update')); return d; };
    useEffect(() => { let live = true; void settingsFetch('/api/orbit/chatgpt', { headers: authHeaders() }).then(async (r) => { if (!r.ok)
        throw new Error('无法读取 ChatGPT 状态'); const d = await r.json(); if (live)
        setStatus(d); }).catch(e => { if (live)
        setMessage(e.message); }); return () => { live = false; }; }, [authHeaders]);
    const registration = async () => { try {
        const data = await api('/api/orbit/chatgpt/registration');
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'orbit-chatgpt-registration.json';
        a.click();
        URL.revokeObjectURL(url);
    }
    catch (e) {
        setMessage(e instanceof Error ? e.message : '下载失败');
    } };
    return <SettingRow label="ChatGPT 套餐连接" description="保留 Orbit 账号登录，使用 ChatGPT 套餐进行手动聊天。仅主账号试点；不会自动接管日报或后台提醒。">
    <div className="settings-stack"><p role="status">{status?.connected ? `已连接 · ${status.email || 'ChatGPT 账号'}` : status?.eligible ? '未连接' : status ? '此账号尚未开放试点' : '正在读取…'}</p>
    {status?.eligible && <><div className="settings-actions"><Popover title="ChatGPT 授权步骤" open={guide} onOpenChange={setGuide} trigger={<Button variant="secondary">Continue with ChatGPT</Button>}><p>在装有 Orbit 源码的本机运行 <code>npm run chatgpt:connect</code>，在系统浏览器完成授权，再导入助手生成的文件。个人服务器采用“本地授权 → 安全导入”流程。</p>{status.clientId && <p>重新授权时使用下载的信息：<code>npm run chatgpt:connect -- --registration &lt;文件路径&gt;</code>，沿用已注册 client ID。</p>}<p>导入完成后删除传输副本，服务器独占刷新；纯远程网页无法直接完成本机 loopback 授权。</p></Popover>{status.clientId && <Button variant="quiet" onClick={() => void registration()}>下载重新授权信息</Button>}{status.connected && <Button variant="danger" disabled={busy} onClick={async () => { if (!await confirm('断开 ChatGPT 连接后，此账号将无法继续使用该 Provider。需要时可以重新授权。是否继续？')) return; setBusy(true); try {
            const d = await api('/api/orbit/chatgpt/disconnect', {});
            setMessage(d.message);
            setStatus(await api('/api/orbit/chatgpt'));
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : '断开失败');
        }
        finally {
            setBusy(false);
        } }}>断开连接</Button>}</div>

    <FilePicker label="导入授权文件" disabled={busy} accept="application/json,.json" onFile={async file => { setBusy(true); setMessage(''); try {
            if (file.size > 65536)
                throw new Error('授权文件超过限制');
            const data = JSON.parse(await file.text());
            setStatus(await api('/api/orbit/chatgpt/import', data));
            setMessage('已导入授权；实际可用模型与套餐额度以 ChatGPT 返回为准。请删除传输副本。');
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : '导入失败');
        }
        finally {
            setBusy(false);
        } }}/></>}
    {message && <p role="status">{message}</p>}<a href="https://chatgpt.com/#settings" target="_blank" rel="noopener noreferrer">管理 ChatGPT 套餐使用与应用访问</a></div>
  </SettingRow>;
}
