import { CloudContextRequestError,requestCloudContext,type CloudContextEnvelope } from '../../services/daily-report-context';
import { loadNotificationPreferences,saveAndReloadNotificationPreferences } from '../../services/notification-preferences';
import { updateContextField,type ContextObject,type ContextPath } from '../../utils/daily-report-context';

export type ContextDomain = 'profile' | 'report';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const message = (error: unknown) => error instanceof Error ? error.message : '读取或保存失败，请重试。';
const domainKeys = (context: ContextObject, domain: ContextDomain) => Object.keys(context).filter(key => (key === 'profile') === (domain === 'profile'));
function mergeDomain(base: ContextObject, from: ContextObject, domain: ContextDomain): ContextObject {
  const next = structuredClone(base);
  for (const key of domainKeys(next, domain)) delete next[key];
  for (const key of domainKeys(from, domain)) next[key] = structuredClone(from[key]);
  return next;
}
function domainValue(context: ContextObject, domain: ContextDomain) { return mergeDomain({}, context, domain); }

/** Account-scoped, in-memory Cloud Context owner. Version and unknown fields stay together. */
export class ContextStore {
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  state = { saved: null as CloudContextEnvelope | null, draft: {} as ContextObject, busy: false, error: '', conflict: false, notice: '' };
  constructor(private headers: Record<string, string>, private fetcher: typeof fetch) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private set(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  dirty(domain?: ContextDomain) { return !!this.state.saved && !equal(domain ? domainValue(this.state.draft, domain) : this.state.draft, domain ? domainValue(this.state.saved.context, domain) : this.state.saved.context); }
  validationContext(domain: ContextDomain) { return mergeDomain(this.state.saved?.context || {}, this.state.draft, domain); }
  ensure = () => this.state.saved || this.loading ? this.loading : this.reload();
  reload = () => {
    if (this.state.busy) return this.loading;
    this.set({ busy: true, error: '', notice: '' });
    this.loading = (async () => {
      try { const saved = await requestCloudContext(this.headers, undefined, this.fetcher); this.set({ saved, draft: structuredClone(saved.context), conflict: false }); }
      catch (error) { this.set({ error: message(error) }); }
      finally { this.loading = undefined; this.set({ busy: false }); }
    })(); return this.loading;
  };
  change = (path: ContextPath, value: unknown) => { if (!this.state.busy) this.set({ draft: updateContextField(this.state.draft, path, value), notice: '' }); };
  update = (transform: (draft: ContextObject) => ContextObject) => { if (!this.state.busy) this.set({ draft: transform(this.state.draft), notice: '' }); };
  reset = (domain: ContextDomain) => { if (this.state.saved && !this.state.busy) this.set({ draft: mergeDomain(this.state.draft, this.state.saved.context, domain), notice: '已取消当前分区的修改。' }); };
  save = async (domain: ContextDomain) => {
    const { saved, draft, busy, conflict } = this.state;
    if (!saved || busy || conflict || !this.dirty(domain)) return;
    this.set({ busy: true, error: '', notice: '' });
    try {
      // Submit only the chosen domain against the shared latest snapshot/version.
      const result = await requestCloudContext(this.headers, { context: mergeDomain(saved.context, draft, domain), expectedVersion: saved.version }, this.fetcher);
      const other: ContextDomain = domain === 'profile' ? 'report' : 'profile';
      this.set({ saved: result, draft: this.dirty(other) ? mergeDomain(this.state.draft, result.context, domain) : structuredClone(result.context), notice: '已保存，下一次 Cloud 日报读取时生效。' });
    } catch (error) { this.set({ error: message(error), conflict: error instanceof CloudContextRequestError && error.status === 409 }); }
    finally { this.set({ busy: false }); }
  };
}

/** Notifications and report email share one serialized PUT→GET owner. */
export class NotificationStore {
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  state = { saved: null as Record<string, any> | null, draft: {} as Record<string, any>, loading: false, pending: 0, error: '', notice: '' };
  constructor(private headers: Record<string, string>, private fetcher: typeof fetch) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private set(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  dirty() { return !!this.state.saved && !equal(this.state.saved, this.state.draft); }
  ensure = () => this.state.saved || this.loading ? this.loading : this.reload();
  reload = () => {
    if (this.state.loading || this.state.pending) return this.loading;
    this.set({ loading: true, error: '' });
    this.loading = (async () => {
      try {
        const result = await loadNotificationPreferences(this.headers, this.fetcher), actual = result.preference || {}, draft = { ...actual };
        for (const field of Object.keys(this.state.draft)) if (this.state.saved && !equal(this.state.draft[field], this.state.saved[field])) draft[field] = this.state.draft[field];
        this.set({ saved: actual, draft });
      }
      catch (error) { this.set({ error: message(error) }); }
      finally { this.loading = undefined; this.set({ loading: false }); }
    })(); return this.loading;
  };
  change = (field: string, value: unknown) => this.set({ draft: { ...this.state.draft, [field]: value }, notice: '' });
  reset = () => { if (this.state.saved && !this.state.pending) this.set({ draft: structuredClone(this.state.saved), error: '', notice: '' }); };
  save = (fields: string[], overrides: Record<string, unknown> = {}) => {
    if (!this.state.saved || this.state.loading) return Promise.resolve();
    const payload = Object.fromEntries(fields.map(field => [field, field in overrides ? overrides[field] : this.state.draft[field]]));
    for (const [field, value] of Object.entries(payload)) this.change(field, value);
    this.set({ pending: this.state.pending + 1, error: '', notice: '' });
    const operation = async () => {
      try {
        const result = await saveAndReloadNotificationPreferences(payload, this.headers, this.fetcher), actual = result.preference || {};
        const preserved = { ...actual };
        // Rebase every other dirty field and edits made while this request was in flight.
        for (const field of Object.keys(this.state.draft)) {
          const changed = !equal(this.state.draft[field], this.state.saved?.[field]);
          if (changed && (!(field in payload) || !equal(this.state.draft[field], payload[field]))) preserved[field] = this.state.draft[field];
        }
        const matches = fields.every(field => equal(payload[field], actual[field]));
        if (!matches) for (const field of fields) preserved[field] = this.state.draft[field];
        this.set({ saved: actual, draft: preserved, error: matches ? '' : '服务器回读与本次修改不一致，草稿已保留，请核对后重试。', notice: matches ? '设置已保存并回读确认。' : '' });
      } catch (error) { this.set({ error: message(error) }); }
      finally { this.set({ pending: this.state.pending - 1 }); }
    };
    this.queue = this.queue.then(operation, operation); return this.queue;
  };
}
