import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { androidCall, isAndroid, syncAndroid, type AndroidStatus } from '../../../services/android-bridge';
import { Button, ExternalLink, Switch } from '../../../ui';
import { SettingRow } from '../SettingFields';
import { useSettingsActive, useSettingsRequest } from '../SettingsState';
import { AndroidNotificationRecords } from './AndroidNotificationRecords';

interface PushTest {
  status: string;
  error?: string | null;
  createdAt: string;
}
interface CloudStatus {
  enabled: boolean;
  configured: boolean;
  scannerEnabled: boolean;
  devices: { id: string; lastTest: PushTest | null }[];
}

const allowed = (value: boolean) => value ? '已开启' : '未开启';
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function describeTest(test: PushTest | null | undefined) {
  if (!test) return '尚未发起服务端测试';
  const state = test.status === 'sent' ? '服务端已接受，等待真机观察'
    : test.status === 'failed' ? '发送失败'
    : test.status === 'suppressed' ? '测试已失效'
    : '等待发送';
  const code = test.error && /^[a-z][a-z_/-]{0,79}$/.test(test.error) ? ' · ' + test.error : '';
  return `FCM：${state}${code} · ${new Date(test.createdAt).toLocaleString()}`;
}

export function AndroidNotificationSettings() {
  const settingsFetch = useSettingsRequest();
  const active = useSettingsActive();
  const { user } = useAuth();
  const android = isAndroid();
  const [native, setNative] = useState<AndroidStatus | null>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [lastSent, setLastSent] = useState<{ deviceId: string; test: PushTest } | null>(null);
  const [nativeError, setNativeError] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const readCloud = useCallback(async (signal?: AbortSignal) => {
    const response = await settingsFetch('/api/android-push', { signal });
    if (!response.ok) throw new Error('服务端通知状态暂不可用，请联网后重试。');
    const status: CloudStatus = await response.json();
    if (!signal?.aborted) {
      setCloud(status);
      setCloudError('');
    }
  }, [settingsFetch]);

  useEffect(() => {
    if (!active) return;
    let request: AbortController | undefined;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      if (android) void androidCall('status').then(status => {
        if (controller.signal.aborted) return;
        setNative(status);
        setNativeError('');
      }).catch(err => {
        if (controller.signal.aborted) return;
        setNative(null);
        setNativeError(errorText(err, '读取手机通知状态失败。'));
      });
      void readCloud(controller.signal).catch(() => {
        if (!controller.signal.aborted) setCloudError('服务端通知状态暂不可用，请联网后重试。');
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('orbit:android-state', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      request?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('orbit:android-state', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [active, android, readCloud]);

  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (err) {
      setError(errorText(err, '通知操作失败。'));
    } finally {
      setBusy(false);
    }
  };
  const method = (name: string, params: Record<string, unknown> = {}) => act(async () => {
    setNative(await androidCall(name, params));
    setNativeError('');
  });
  const refreshRegistration = () => act(async () => {
    setNative(await syncAndroid());
    setNativeError('');
    await readCloud();
  });
  const sendTest = () => act(async () => {
    const status = await syncAndroid();
    setNative(status);
    if (!status.binding || !status.fid) throw new Error('请先完成谷歌推送注册和设备绑定。');
    const deviceId = status.binding.id;
    const createdAt = new Date().toISOString();
    const response = await settingsFetch(`/api/android-push/devices/${encodeURIComponent(deviceId)}/test`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '谷歌推送测试失败。');
    setLastSent({ deviceId, test: { status: result.status, error: result.error, createdAt } });
  });

  const diagnostics = native?.notificationDiagnostics;
  const canTest = Boolean(diagnostics || native?.developerTools);
  const localAllowed = native?.notificationPermission && diagnostics?.localChannelEnabled !== false;
  const fcmAllowed = native?.notificationPermission && diagnostics?.fcmChannelEnabled !== false && diagnostics?.googlePlayAvailable !== false;
  const deviceId = native?.binding && native.binding.accountId === user?.id ? native.binding.id : undefined;
  const serverTest = cloud?.devices.find(device => device.id === deviceId)?.lastTest;
  const actionTest = lastSent?.deviceId === deviceId ? lastSent?.test : undefined;
  const result = describeTest(actionTest && (!serverTest || actionTest.createdAt > serverTest.createdAt) ? actionTest : serverTest);
  const permissionSummary = native ? `系统通知：${allowed(native.notificationPermission)}${canTest ? ` · 精确闹钟：${allowed(native.exactAlarmPermission)}` : ''}` : '正在读取手机状态…';
  const channelSummary = diagnostics ? `本地测试类别：${allowed(diagnostics.localChannelEnabled)} · 谷歌推送类别：${allowed(diagnostics.fcmChannelEnabled)}` : '';
  const googleSummary = diagnostics ? `Google Play 服务：${diagnostics.googlePlayAvailable ? '可用' : '缺失、停用或需更新'}` : '';
  const registrationState = native?.fcmConfigured ? (deviceId && native.fid ? '已注册' : native.fcmState) : '客户端未配置';
  const registrationSummary = native ? `FCM：${registrationState} · 设备：${deviceId ? '已绑定' : '未绑定'}` : '';
  const cloudSummary = cloudError || (cloud ? `服务端 FCM：${cloud.configured ? '已配置' : '未配置'} · 正式推送：${cloud.enabled ? '账号已开启' : '账号未开启'}${cloud.enabled && !cloud.scannerEnabled ? '，服务端扫描未启用' : ''}` : '正在读取服务端状态…');
  const localResult = native?.localResult || '尚未安排本地测试';
  const fcmResult = deviceId && native?.fcmResult ? native.fcmResult : '未记录';

  return <div aria-label="Android 手机提醒设置">
    <SettingRow label="Android 手机提醒" description={android ? '独立账号开关。普通日程和周期事务通过谷歌推送发送。' : '独立账号开关，默认关闭。普通日程和周期事务通过 FCM 发送标题与时间。请安装 Orbit Android 客户端后，在这里授权手机通知。'}>
      <Switch label="Android 手机提醒" checked={cloud?.enabled ?? false} disabled={busy || !cloud || Boolean(cloudError)} onCheckedChange={value => void act(async () => {
        const response = await settingsFetch('/api/android-push/preferences', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: value }),
        });
        if (!response.ok) throw new Error('手机提醒设置保存失败。');
        await readCloud();
      })}/>
      {android || cloudError ? <p className="settings-help" role="status">{cloudSummary}</p> : <>
        {!cloud?.configured && <p className="settings-help">服务端 FCM 未配置。</p>}
        {cloud?.enabled && !cloud.scannerEnabled && <p className="settings-help">服务端 Push 扫描未启用，真实事项暂不投递。</p>}
      </>}
    </SettingRow>
    {!android ? <p className="settings-note" role="status">当前设备：Web</p> : <>
      <SettingRow label={canTest ? '通知诊断' : '系统权限与注册'} description="先检查手机权限和通知类别，再分别测试本地和谷歌推送。">
        <div className="settings-help" role="status">
          <p>{nativeError || permissionSummary}</p>
          {channelSummary && <p>{channelSummary}</p>}
          {googleSummary && <p>{googleSummary}</p>}
          {registrationSummary && <p>{registrationSummary}{native?.pendingRevocations ? ` · 待补偿解绑 ${native.pendingRevocations} 项` : ''}</p>}
        </div>
        <div className="settings-actions">
          <Button disabled={busy || !native} onClick={() => void method('permission')}>授权系统通知</Button>
          {canTest && (!diagnostics || diagnostics.androidApi >= 31) && <Button variant="secondary" disabled={busy} onClick={() => void method('exactPermission')}>开启闹钟和提醒</Button>}
          {diagnostics && <>
            <Button variant="secondary" disabled={busy} onClick={() => void method('notificationChannel', { kind: 'local' })}>本地类别设置</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void method('notificationChannel', { kind: 'fcm' })}>推送类别设置</Button>
          </>}
          <Button variant="secondary" disabled={busy} onClick={() => void refreshRegistration()}>刷新注册状态</Button>
        </div>
        {native && !canTest && <p className="settings-help">更新 Orbit Android 客户端后可使用常驻通知测试。</p>}
      </SettingRow>
      {canTest && <>
        <SettingRow label="一分钟后本地提醒" description="安排后按 Home 或锁屏，先看系统通知栏，再回这里对照触发时间。可以断网测试。">
          <div className="settings-actions">
            <Button disabled={busy || !localAllowed || !native?.exactAlarmPermission} onClick={() => void method('scheduleLocal', { exact: true })}>一分钟后本地提醒</Button>
            <Button variant="secondary" disabled={busy || !localAllowed} onClick={() => void method('scheduleLocal', { exact: false })}>非精确测试（可能延迟）</Button>
            <Button variant="secondary" disabled={busy || !native?.pendingLocal} onClick={() => void method('cancelLocal')}>取消本地测试</Button>
            {diagnostics && <Button variant="secondary" disabled={busy} onClick={() => void method('openLocalDiagnostics')}>打开离线测试面板</Button>}
          </div>
          <p className="settings-help" role="status">{native?.pendingLocal ? `${native.pendingLocal.exact ? '精确' : '非精确'}测试待触发：${new Date(native.pendingLocal.dueAt).toLocaleTimeString()}` : '没有待触发本地测试'}<br />{localResult}</p>
          <p className="settings-help">每次安排会替换前一次。手机重启后需重新安排，强行停止也可能取消预约。</p>
        </SettingRow>
        <SettingRow label="谷歌推送测试" description="联网并完成设备注册后发送一次测试。可先在前台测试，再锁屏观察系统通知和点击行为。">
          <Button disabled={busy || Boolean(cloudError) || !cloud?.configured || !native?.fcmConfigured || !native.fid || !fcmAllowed} onClick={() => void sendTest()}>发送 FCM 测试</Button>
          <p className="settings-help" role="status">{result}<br />手机回调：{fcmResult}</p>
          <details>
            <summary>荣耀手机与无谷歌服务的设备</summary>
            <p className="settings-help">本地测试可用来检查权限和后台唤醒。谷歌推送还需要设备能连接 Google。荣耀系统推送需另行申请服务，并登记包名和签名指纹。</p>
            <ExternalLink href="https://developer.honor.com/cn/doc/guides/101074">查看荣耀 Push 申请条件</ExternalLink>
          </details>
        </SettingRow>
        {user && <AndroidNotificationRecords key={user.id} accountId={user.id} summary={[
          `Orbit Android ${native?.version ?? '未知'}${diagnostics ? ` · Android API ${diagnostics.androidApi}` : ''}`,
          permissionSummary, channelSummary, googleSummary, registrationSummary, cloudSummary,
          localResult, result, `手机回调：${fcmResult}`,
        ].filter(Boolean)} />}
      </>}
    </>}
    {error && <p className="settings-status" role="alert">{error}</p>}
  </div>;
}
