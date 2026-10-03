import test from 'node:test';
import assert from 'node:assert/strict';
import { workBuddyModel } from './ai-provider-contract.js';
import { ORBIT_AI_QUERY_POLICY } from './orbit-ai-policy.js';
test('capabilities come from catalog fields, never a model name', () => {
  assert.equal(workBuddyModel({ modelId: 'vision-pro' }).capabilities.images.supported, null);
  const model = workBuddyModel({ modelId: 'plain', supportsImages: true, supportsToolCall: false, maxImageCount: 3 });
  assert.deepEqual(model.capabilities.images, { supported: true, evidence: 'catalog' });
  assert.equal(model.capabilities.tools.supported, false);
  assert.equal(workBuddyModel({ modelId: 'x', supportsImages: true, disabledMultimodal: true }).capabilities.images.supported, false);
  assert.deepEqual(ORBIT_AI_QUERY_POLICY.tools, []);
  assert.deepEqual(ORBIT_AI_QUERY_POLICY.settingSources, []);
});
