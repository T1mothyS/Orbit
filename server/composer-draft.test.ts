import test from 'node:test';
import assert from 'node:assert/strict';
import { composerDraftKey, readComposerDraft, updateComposerDraft, snapshotComposerDraft, consumeComposerDraft, clearAccountComposerDrafts, subscribeComposerDraft } from '../src/utils/composer-draft.js';
import { escapeClipboardHtml } from '../src/utils/note-clipboard.js';

const saved = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', { value: { getItem: (key: string) => saved.get(key) || null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key), key: (index: number) => [...saved.keys()][index], get length() { return saved.size; } }, configurable: true });
test('成功消费清理持久草稿；切走、重新挂载不会恢复已发送文字', () => {
  const key = composerDraftKey('one', 'conversation'); saved.set(key, '旧版草稿');
  assert.equal(readComposerDraft(key).text, '旧版草稿');
  consumeComposerDraft(snapshotComposerDraft(key), true);
  assert.equal(saved.has(key), false); assert.equal(readComposerDraft(key).text, '');
});
test('慢响应保留新文字与新图片，只消费已提交图片；账号清理不影响他人', () => {
  const key = composerDraftKey('one', 'slow'), other = composerDraftKey('two', 'slow');
  const image = { id: 'image-one', name: 'one.png', mime: 'image/png', size: 100 };
  updateComposerDraft(key, { text: '保存中的文字', images: [image] }); const snapshot = snapshotComposerDraft(key);
  updateComposerDraft(key, { text: '新的草稿', images: [image, { ...image, id: 'image-two' }] });
  assert.equal(consumeComposerDraft(snapshot, true), false);
  assert.equal(readComposerDraft(key).text, '新的草稿'); assert.deepEqual(readComposerDraft(key).images.map(image => image.id), ['image-two']);
  updateComposerDraft(other, { text: '其他账号' }); clearAccountComposerDrafts('one');
  assert.equal(saved.has(key), false); assert.equal(readComposerDraft(other).text, '其他账号');
});
test('富文本复制转义文字和属性，不把用户输入当 HTML', () => {
  assert.equal(escapeClipboardHtml('<img onerror="x"> & \'text\''), '&lt;img onerror=&quot;x&quot;&gt; &amp; &#39;text&#39;');
});
test('退出账号清理在活动监听器读取缓存时仍能结束，并清空输入', () => {
  const key = composerDraftKey('observed-account', 'conversation');
  updateComposerDraft(key, { text: '退出前草稿' });
  let notifications = 0;
  const stop = subscribeComposerDraft(changed => { if (changed === key) { notifications++; assert.equal(readComposerDraft(key).text, ''); } });
  try { clearAccountComposerDrafts('observed-account'); assert.equal(notifications, 1); assert.equal(saved.has(key), false); }
  finally { stop(); }
});
