import assert from 'node:assert/strict';
import test from 'node:test';
import { triggerWorkspaceResearch } from './digest-research-trigger.js';
import type { ResearchRun } from './digest-research-store.js';

const run: ResearchRun = {
  id: 'synthetic-run', userId: 'synthetic-user', candidateKey: 'synthetic-candidate',
  subjectKey: 'synthetic-subject', subjectTitle: 'Synthetic Subject', question: 'What changed?',
  eventRevisionId: null, status: 'pending', resultBody: null,
  createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
  leaseUntil: null, attempts: 0,
};

test('D13 synthetic Workspace Agent trigger sends a bounded request and treats 202 as queued only', async () => {
  let calls = 0;
  const fakeSend: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://api.chatgpt.com/v1/workspace_agents/agtch_synthetic/trigger');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['Idempotency-Key'], run.id);
    assert.match(String(init?.body), /What changed/);
    assert.doesNotMatch(String(init?.body), /synthetic-user/);
    return new Response(JSON.stringify({ conversation_url: 'https://chatgpt.com/c/synthetic', agent_trigger_run_id: 'apirun_synthetic' }), { status: 202 });
  };
  const result = await triggerWorkspaceResearch(run, { triggerId: 'agtch_synthetic', accessToken: 'synthetic-token' }, fakeSend);
  assert.deepEqual(result, { conversationUrl: 'https://chatgpt.com/c/synthetic', agentRunId: 'apirun_synthetic' });
  assert.equal(calls, 1);
  await assert.rejects(() => triggerWorkspaceResearch(run, { triggerId: 'agtch_synthetic', accessToken: 'synthetic-token' },
    async () => new Response('{}', { status: 401 })), /HTTP 401/);
  await assert.rejects(() => triggerWorkspaceResearch(run, { triggerId: 'agtch_synthetic', accessToken: 'synthetic-token' },
    async () => new Response('{}', { status: 202 })), /回执无效/);
  await assert.rejects(() => triggerWorkspaceResearch(run, { triggerId: '', accessToken: '' }, fakeSend), /未配置/);
  assert.equal(calls, 1);
});
