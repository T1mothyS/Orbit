import { queryOne } from './database/connection.js';
import { orbitQuickReplies, type OrbitQuickReply } from '../src/utils/orbit-quick-reply.js';

export const ORBIT_IDLE_MS = 30 * 60_000;

// Old records lack round metadata. Keep them readable before a cutoff and
// exclude replies from older tagged jobs even when they finished after it.
export const messageMeta = (column = 'orbit_meta') => `CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END`;
export const roundFilter = (alias = '') => {
  const prefix = alias ? alias + '.' : '';
  return `${prefix}created_at>=? AND COALESCE(json_extract(${messageMeta(prefix + 'orbit_meta')},'$.roundStartedAt'),?)=?`;
};
export const roundParams = (round: string) => [round, round, round];

export function resolveOrbitRound(userId: string, cid: string, submittedAt: Date) {
  const requestRound = queryOne<{ at: string | null }>(
    "SELECT MAX(json_extract(execution_meta,'$.roundStartedAt')) AS at FROM orbit_requests WHERE user_id=? AND conversation_id=? AND json_valid(execution_meta)", [userId, cid],
  )?.at;
  const historyRound = queryOne<{ at: string | null }>(
    `SELECT MAX(json_extract(${messageMeta()},'$.roundStartedAt')) AS at FROM ai_schedule_messages WHERE user_id=? AND conversation_id=?`, [userId, cid],
  )?.at;
  const round = [requestRound || '', historyRound || ''].sort().at(-1)!;
  const lastUserRequest = queryOne<{ at: string | null }>(
    `SELECT MAX(created_at) AS at FROM orbit_requests WHERE user_id=? AND conversation_id=? AND created_at>=?
     AND COALESCE(json_extract(${messageMeta('execution_meta')},'$.continuationOf'),'')=''
     AND COALESCE(json_extract(${messageMeta('execution_meta')},'$.roundStartedAt'),?)=?`, [userId, cid, ...roundParams(round)],
  )?.at;
  const lastMessage = queryOne<{ at: string | null }>(
    `SELECT MAX(created_at) AS at FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? AND ${roundFilter()}
     AND role IN ('user','assistant') AND COALESCE(json_extract(${messageMeta()},'$.origin'),'') NOT IN ('notification','proactive')`,
    [userId, cid, ...roundParams(round)],
  )?.at;
  const last = Math.max(Date.parse(lastUserRequest || '') || 0, Date.parse(lastMessage || '') || 0);
  return last > 0 && submittedAt.getTime() - last >= ORBIT_IDLE_MS ? submittedAt.toISOString() : round;
}

const expired = '这条快捷回答已过期，请重新描述你想安排的事项。';

export function parseOrbitQuickReply(value: unknown, text: string): OrbitQuickReply | undefined {
  if (value === undefined) return;
  const reply = value as Partial<OrbitQuickReply> | null;
  if (!reply || typeof reply.messageId !== 'string' || reply.messageId.length > 100 ||
      (reply.choice !== 'draft' && reply.choice !== 'discuss') || text !== orbitQuickReplies[reply.choice]) {
    throw new Error('快捷回答无效，请重新描述事项。');
  }
  return { messageId: reply.messageId, choice: reply.choice };
}

export function quickReplySource(userId: string, cid: string, reply: OrbitQuickReply, round: string) {
  const source = queryOne<{ body: string }>(
    `SELECT r.body FROM ai_schedule_messages m JOIN orbit_requests r ON r.user_id=m.user_id AND r.conversation_id=m.conversation_id
       AND r.id=json_extract(${messageMeta('m.orbit_meta')},'$.requestId')
     WHERE m.user_id=? AND m.conversation_id=? AND m.id=? AND m.role='assistant' AND r.state='completed'
       AND json_extract(${messageMeta('m.orbit_meta')},'$.scheduleQuickReplies')=1 AND ${roundFilter('m')}`,
    [userId, cid, reply.messageId, ...roundParams(round)],
  );
  if (!source) throw new Error(expired);
  const { text, targetDate } = JSON.parse(source.body);
  if (typeof text !== 'string' || typeof targetDate !== 'string') throw new Error(expired);
  return { text, targetDate };
}

export function assertQuickReplyAvailable(userId: string, cid: string, reply: OrbitQuickReply, round: string) {
  quickReplySource(userId, cid, reply, round);
  if (queryOne(
    "SELECT id FROM orbit_requests WHERE user_id=? AND conversation_id=? AND json_extract(body,'$.quickReply.messageId')=?",
    [userId, cid, reply.messageId],
  )) throw new Error('这条快捷回答已发送。可以在对话中继续补充。');
}
