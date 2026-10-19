import { queryAll } from './database/connection.js';

interface Entry { kind: string; id: string; at: number }
const encode = (entry: Entry) => Buffer.from(JSON.stringify([entry.at, entry.kind, entry.id])).toString('base64url');
function decode(value: unknown): [number, string, string] | undefined {
  if (!value) return;
  const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString());
  if (!Array.isArray(parsed) || parsed.length !== 3 || !Number.isFinite(parsed[0]) || !['message', 'request'].includes(parsed[1]) || typeof parsed[2] !== 'string') throw new Error('历史游标无效');
  return parsed as [number, string, string];
}
/** Page the combined chronology, including requests that never produced a message. */
export function chatTimelinePage(userId: string, cid: string, options: { before?: unknown; after?: unknown; limit?: unknown }) {
  const before = decode(options.before), after = decode(options.after);
  if (before && after) throw new Error('历史游标不能同时指定');
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 60)));
  const base = `WITH timeline AS (
    SELECT 'message' AS kind,m.id,julianday(COALESCE(r.created_at,m.created_at)) AS at
    FROM ai_schedule_messages m LEFT JOIN orbit_requests r ON r.user_id=m.user_id AND r.conversation_id=m.conversation_id AND substr(m.id,1,length('orbit-user:'||m.user_id||':'))='orbit-user:'||m.user_id||':' AND r.id=substr(m.id,length('orbit-user:'||m.user_id||':')+1)
    WHERE m.user_id=? AND m.conversation_id=?
    UNION ALL SELECT 'request',id,julianday(created_at) FROM orbit_requests WHERE user_id=? AND conversation_id=?
  )`;
  const args = [userId, cid, userId, cid];
  // A queued request can precede its deterministic user message. Refresh the whole
  // boundary instant so that a late message sorting before the request is included.
  const rows = queryAll<Entry>(`${base} SELECT * FROM timeline ${before ? 'WHERE (at,kind,id)<(?,?,?)' : after ? 'WHERE at>=?' : ''} ORDER BY at DESC,kind DESC,id DESC ${after ? '' : 'LIMIT ?'}`, [...args, ...(before || (after ? [after[0]] : [])), ...(after ? [] : [limit + 1])]);
  const page = (after ? rows : rows.slice(0, limit)).reverse();
  const first = page[0];
  const hasMore = !!first && !!queryAll(`${base} SELECT id FROM timeline WHERE (at,kind,id)<(?,?,?) LIMIT 1`, [...args, first.at, first.kind, first.id]).length;
  return { entries: page, nextBefore: hasMore && first ? encode(first) : null, start: first ? encode(first) : null };
}
