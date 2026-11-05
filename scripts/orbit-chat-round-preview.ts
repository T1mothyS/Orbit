import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as db from '../server/db.js';
import { workBuddyProvider } from '../server/ai-provider-workbuddy.js';
import { createConversation, ensureDefaultConversation, getRequest, setAiSelection } from '../server/orbit-store.js';
import { submitOrbitRequest } from '../server/orbit-queue.js';
import { dateInZone } from '../server/orbit-time.js';
import { createSchedule } from '../server/schedule-store.js';

export const roundPreviewModel = 'orbit-local-preview';
export const roundPreviewEmail = 'preview-round@example.invalid';

export async function seedChatRoundPreview() {
  const uid = 'preview-chat-round';
  const now = new Date();
  const stamp = now.toISOString();
  const today = dateInZone(now, 'Asia/Shanghai');
  db.createUser({ id: uid, email: roundPreviewEmail, password_hash: await bcrypt.hash('OrbitPreview123!', 10),
    role: 'user', disabled: 0, created_at: stamp, updated_at: stamp });
  db.upsertUserApiKey({ id: randomUUID(), user_id: uid, api_key: 'synthetic-loopback-preview', base_url: null, created_at: stamp, updated_at: stamp });
  setAiSelection(uid, { provider: 'workbuddy', models: { workbuddy: roundPreviewModel } });

  const cid = ensureDefaultConversation(uid);
  db.createAiScheduleMessage({ id: randomUUID(), user_id: uid, conversation_id: cid, role: 'assistant', type: 'text',
    content: '已记下之前的安排。你随时可以翻回来看。', intent: 'chat', plan: null, schedule_items: null,
    created_at: new Date(now.getTime() - 31 * 60_000).toISOString() });
  for (const [index, title] of ['去换手机电池', '送洗鞋子'].entries()) {
    createSchedule({ id: `preview-round-${index}`, user_id: uid, calendar_id: 'personal', title,
      type: 'todo', start_time: `${today}T10:00:00`, end_time: `${today}T10:00:00`, all_day: false,
      is_unscheduled: false, category: index === 0 ? 'life' : 'work', priority: 'medium', is_completed: index === 1,
      is_repeated: false, reminders: [], is_high_risk: false,
      ...(index === 0 ? { location: '手机维修店' } : { notes: '换手机电池的路上顺路送洗' }) });
  }

  workBuddyProvider.generate = async request => {
    if (request.userId !== uid) throw new Error('此预览只为演示账号提供合成回复。');
    await new Promise(resolve => setTimeout(resolve, 1200));
    request.controller?.signal.throwIfAborted();
    const prompt = request.input[0]?.type === 'text' ? request.input[0].text : '';
    const title = prompt.includes('资料归档') ? '资料归档活动' : '照片备份活动';
    if (request.responseMode === 'draft') return JSON.stringify({
      intent: 'create', reply: `已整理出「${title}」的草稿，请核对后再确认。`, warnings: [],
      operations: [{ type: 'create', data: { title, type: 'event', start_time: `${today}T15:00:00`, end_time: `${today}T17:00:00`, category: 'life' } }],
    });
    return `可以先列出「${title}」要准备的材料，再确定参与人和具体安排。你想先讨论哪一项？`;
  };

  const discussion = createConversation(uid, '快捷回答 · 讨论示例');
  for (const [conversationId, text] of [
    [cid, '今天有哪些日程安排？'],
    [cid, '今天 15:00-17:00 举办照片备份活动'],
    [discussion.id, '今天 15:00-17:00 举办资料归档活动'],
  ]) {
    const requestId = randomUUID();
    submitOrbitRequest(uid, { text, requestId, conversationId, targetDate: today, model: roundPreviewModel });
    for (let i = 0; i < 100; i++) {
      const row = getRequest(uid, requestId);
      if (row?.state === 'completed') break;
      if (row?.state === 'failed' || i === 99) throw new Error('合成聊天示例未生成。');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}
