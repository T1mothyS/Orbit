import type { NoteImage } from './note-images';

export interface NotificationContext { notificationId: string; title: string }
export interface ComposerDraft { text: string; images: NoteImage[]; revision: string; notificationContext?: NotificationContext }
export interface ComposerSnapshot extends ComposerDraft { key: string }
const drafts = new Map<string, ComposerDraft>();
const listeners = new Set<(key: string) => void>();
let revision = 0;
export const composerDraftKey = (owner: string, conversation: string) => `orbit-draft:${owner}:${conversation}`;
const empty = (): ComposerDraft => ({ text: '', images: [], revision: '' });
export function readComposerDraft(key: string): ComposerDraft {
  if (drafts.has(key)) return drafts.get(key)!;
  let draft = empty();
  try {
    const value = sessionStorage.getItem(key);
    if (value) {
      try {
        const saved = JSON.parse(value);
        if (saved?.format === 2 && typeof saved.text === 'string' && Array.isArray(saved.images)) {
          const context = saved.notificationContext;
          draft = { text: saved.text, images: saved.images.filter((image: NoteImage) => typeof image?.id === 'string'), revision: String(saved.revision || ''),
            ...(typeof context?.notificationId === 'string' && context.notificationId.length > 0 && context.notificationId.length <= 200 && typeof context.title === 'string'
              ? { notificationContext: { notificationId: context.notificationId, title: context.title.slice(0, 200) } } : {}) };
        } else draft.text = value;
      } catch { draft.text = value; }
    }
  } catch { /* Memory drafts remain usable when storage is unavailable. */ }
  drafts.set(key, draft);
  return draft;
}
export function updateComposerDraft(key: string, patch: Partial<Pick<ComposerDraft, 'text' | 'images' | 'notificationContext'>>): ComposerDraft {
  const draft = { ...readComposerDraft(key), ...patch, revision: `${Date.now()}:${++revision}` };
  drafts.set(key, draft);
  try {
    if (!draft.text && !draft.images.length && !draft.notificationContext) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify({ format: 2, ...draft }));
  } catch { /* Do not block editing on browser storage failure. */ }
  listeners.forEach(listener => listener(key));
  return draft;
}
export function snapshotComposerDraft(key: string): ComposerSnapshot {
  return { key, ...readComposerDraft(key), images: [...readComposerDraft(key).images] };
}
/** Only consume the submitted version, even after a remount or conversation switch. */
export function consumeComposerDraft(snapshot: ComposerSnapshot, includeImages: boolean): boolean {
  const current = readComposerDraft(snapshot.key);
  const unchanged = current.revision === snapshot.revision;
  // Submitted images belong to the saved card, even if newer text was typed meanwhile.
  const images = includeImages ? current.images.filter(image => !snapshot.images.some(saved => saved.id === image.id)) : current.images;
  if (unchanged || images.length !== current.images.length) updateComposerDraft(snapshot.key, { text: unchanged ? '' : current.text, images, notificationContext: unchanged ? undefined : current.notificationContext });
  return unchanged;
}
export function subscribeComposerDraft(listener: (key: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function clearAccountComposerDrafts(owner: string) {
  const prefix = `orbit-draft:${owner}:`;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch { /* Account-scoped memory is cleared regardless of storage access. */ }
  // Listeners may read and reinsert an empty draft; iterate a frozen key list.
  for (const key of [...drafts.keys()]) if (key.startsWith(prefix)) { drafts.delete(key); listeners.forEach(listener => listener(key)); }
}
