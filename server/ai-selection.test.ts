import assert from 'node:assert/strict';
import test from 'node:test';
import { initialModel, parseAiSelection } from '../src/utils/ai-selection.js';
test('saved model IDs remain exact across catalog ordering, new versions and unavailability', () => {
  const catalog = [{ id: 'new-luna', name: 'New Luna' }, { id: 'previous-luna', name: 'Previous Luna' }];
  assert.equal(initialModel('chatgpt', catalog, 'previous-luna'), 'previous-luna');
  assert.equal(initialModel('chatgpt', [...catalog].reverse(), 'previous-luna'), 'previous-luna');
  assert.equal(initialModel('chatgpt', catalog.slice(0, 1), 'previous-luna'), 'previous-luna');
  assert.equal(initialModel('chatgpt', catalog), 'new-luna');
  assert.equal(initialModel('chatgpt', [{ id: 'astra', name: 'Astra' }]), '');
  assert.equal(initialModel('workbuddy', [{ id: 'first', name: 'First' }, { id: 'preferred', name: 'Preferred' }], undefined, 'preferred'), 'preferred');
  assert.equal(initialModel('workbuddy', [{ id: 'first', name: 'First' }], undefined, 'previous-default'), 'previous-default');
});
test('only known providers and bounded concrete model IDs are retained, without credentials', () => {
  assert.deepEqual(parseAiSelection({ provider: 'chatgpt', models: { workbuddy: 'glm-5.1', chatgpt: 'saved-luna' }, token: 'discarded' }), { provider: 'chatgpt', models: { workbuddy: 'glm-5.1', chatgpt: 'saved-luna' } });
  for (const value of [null, [], {}, { provider: 'other', models: {} }, { provider: 'chatgpt', models: {} }, { provider: 'chatgpt', models: { chatgpt: ' x' } }, { provider: 'chatgpt', models: { chatgpt: 'a\nb' } }, { provider: 'chatgpt', models: { chatgpt: 'x'.repeat(201) } }, { provider: 'chatgpt', models: { chatgpt: 'luna', key: 'unwanted' } }]) assert.throws(() => parseAiSelection(value));
});
