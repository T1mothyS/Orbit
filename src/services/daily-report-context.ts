import { isContextObject, type ContextObject } from '../utils/daily-report-context';

export interface CloudContextEnvelope {
  version: number;
  context: ContextObject;
  createdAt: string | null;
  updatedAt: string | null;
  readFailed: boolean;
}
export class CloudContextRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); }
}
export async function requestCloudContext(headers: Record<string, string>,
  save?: { context: ContextObject; expectedVersion: number }, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<CloudContextEnvelope> {
  const response = await fetcher('/api/daily-report/cloud-context', {
    method: save ? 'PUT' : 'GET', cache: 'no-store', signal,
    headers: { ...headers, ...(save ? { 'Content-Type': 'application/json' } : {}) },
    ...(save ? { body: JSON.stringify(save) } : {}),
  });
  let result;
  try { result = await response.json(); } catch { throw new CloudContextRequestError('服务暂时不可用，请重试；当前草稿仍保留', response.status); }
  if (!response.ok) throw new CloudContextRequestError(result?.error || '读取或保存资料失败', response.status, result?.code);
  const envelope = result?.context;
  if (!isContextObject(envelope) || !Number.isSafeInteger(envelope.version) || (envelope.version as number) < 0
    || !isContextObject(envelope.context) || typeof envelope.readFailed !== 'boolean') throw new CloudContextRequestError('服务返回的资料格式无效', response.status);
  if (envelope.readFailed) throw new CloudContextRequestError('已保存的资料读取异常，请先恢复资料，不能用空内容覆盖', 409, 'CONTEXT_READ_FAILED');
  return envelope as unknown as CloudContextEnvelope;
}
