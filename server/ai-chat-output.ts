import { z } from 'zod';
import { AiExecutionError } from './ai-execution.js';
const text = z.string().max(20000);
const data = z.object({
  title: text.optional(), start_time: text.optional(), end_time: text.nullable().optional(),
  all_day: z.boolean().optional(), is_unscheduled: z.boolean().optional(),
  location: text.nullable().optional(), notes: text.nullable().optional(),
  category: z.enum(['travel','work','social','life','health','other']).optional(),
  priority: z.enum(['high','medium','low']).optional(), type: z.enum(['event','todo']).optional(),
}).strict();
const recurrence = z.object({ frequency: z.enum(['interval','monthly','yearly']), anchorDate: text,
  interval: z.number().int().positive(), unit: z.enum(['day','month','year']), reminderOffsets: z.array(z.number().int()), reminderTime: text }).strict();
const draft = z.object({
  intent: z.enum(['create','update','delete','query','chat']), reply: text.min(1),
  warnings: z.array(text).max(10).optional(), knowledgeSourceIds: z.array(text).optional(),
  operations: z.array(z.object({type:z.enum(['create','create_recurring','update','delete']),scheduleId:text.optional(),data:data.optional(),recurrence:recurrence.nullable().optional()}).strict()).max(50),
}).strict();
function nativeSchema(value: any): any {
  if (Array.isArray(value)) return value.map(nativeSchema);
  if (!value || typeof value !== 'object') return value;
  const result: any = Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$schema').map(([key,v])=>[key,nativeSchema(v)]));
  if (result.properties) {
    const required = new Set(result.required || []);
    for (const key of Object.keys(result.properties)) if (!required.has(key)) result.properties[key] = { anyOf: [result.properties[key], {type:'null'}] };
    result.required = Object.keys(result.properties); result.additionalProperties = false;
  }
  return result;
}
export const AI_DRAFT_SCHEMA = nativeSchema(z.toJSONSchema(draft)) as Record<string,unknown>;
export function parseDraftOutput(raw: string) {
  try {
    const value = JSON.parse(raw);
    // Native schemas represent omitted optional values as null. Preserve deliberate clearing fields.
    if (value && Array.isArray(value.operations)) for (const op of value.operations) {
      if (!op || typeof op !== 'object') continue;
      if (op.scheduleId === null) delete op.scheduleId;
      if (op.data === null) delete op.data;
      if (op.data && typeof op.data === 'object') for (const key of Object.keys(op.data)) if (op.data[key] === null && !['end_time','location','notes'].includes(key)) delete op.data[key];
    }
    if (value?.warnings === null) delete value.warnings;
    if (value?.knowledgeSourceIds === null) delete value.knowledgeSourceIds;
    const parsed = draft.parse(value);
    if (['chat','query'].includes(parsed.intent) && parsed.operations.length) throw new Error('回答不能包含操作');
    return parsed;
  } catch { throw new AiExecutionError('MODEL_OUTPUT','草稿结构无效','validation'); }
}
