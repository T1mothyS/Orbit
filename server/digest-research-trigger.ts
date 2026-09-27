import type { ResearchRun } from './digest-research-store.js';

/** Contract probe only: an accepted trigger cannot return the agent's research output. */
export async function triggerWorkspaceResearch(
  run: ResearchRun,
  config: { triggerId: string; accessToken: string },
  send: typeof fetch = fetch,
): Promise<{ conversationUrl: string; agentRunId: string | null }> {
  if (!/^agtch_[A-Za-z0-9_-]+$/.test(config.triggerId) || !config.accessToken.trim()) {
    throw new Error('Workspace Agent API 通道或令牌未配置');
  }
  const response = await send(`https://api.chatgpt.com/v1/workspace_agents/${config.triggerId}/trigger`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'workspace_agent_runs=v1',
      'Idempotency-Key': run.id,
    },
    body: JSON.stringify({
      conversation_key: `research_${run.id}`,
      input: `研究请求 ${run.id}\n研究对象：${run.subjectTitle}\n问题：${run.question}\n请只依据可核验来源研究，并将结果作为草稿提交；不要确认 Thesis 或发送提醒。`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 202) throw new Error(`Workspace Agent 触发未被接受（HTTP ${response.status}）`);
  const payload = await response.json() as Record<string, unknown>;
  if (typeof payload.conversation_url !== 'string' || !/^https:\/\/chatgpt\.com\/c\//.test(payload.conversation_url) ||
    (payload.agent_trigger_run_id != null && (typeof payload.agent_trigger_run_id !== 'string' || !payload.agent_trigger_run_id.startsWith('apirun_')))) {
    throw new Error('Workspace Agent 触发回执无效');
  }
  return { conversationUrl: payload.conversation_url, agentRunId: payload.agent_trigger_run_id as string | null ?? null };
}
