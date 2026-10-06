import { z } from 'zod';
const text = (max: number) => z.string().max(max);
const list = (max = 20) => z.array(text(500)).max(max);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().startsWith(value),
    '日期无效',
  );
export const experienceMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  subtype: z.enum(['travel', 'other']),
  time: z
    .object({
      description: text(300),
      start: date.optional(),
      end: date.optional(),
    })
    .refine(
      (v) => !v.start || !v.end || v.start <= v.end,
      '结束日期早于开始日期',
    ),
  places: list(),
  impression: text(1000),
  rating: z
    .object({
      value: z.number().finite().nonnegative(),
      scale: z.number().finite().positive().optional(),
      description: text(300),
    })
    .refine((v) => !v.scale || v.value <= v.scale, '评分超出量表')
    .optional(),
  repeatIntent: z.enum(['yes', 'no', 'conditional', 'unknown']),
  audienceNotes: list(),
  lessons: list(),
  imageIds: z
    .array(z.string().uuid())
    .max(3)
    .refine((ids) => new Set(ids).size === ids.length, '图片重复'),
});
export const experienceDraftSchema = z
  .object({
    title: text(240).min(1),
    summary: text(1000),
    content: text(100000).min(1),
    tags: z.array(text(50)).max(30),
    experience: experienceMetadataSchema,
  })
  .refine((v) => !!v.title.trim() && !!v.content.trim(), '标题和正文不能为空');
const stamp = z
  .string()
  .max(80)
  .refine((v) => !Number.isNaN(Date.parse(v)), '时间无效');
export const experienceDataSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: text(20000),
        at: stamp,
        requestId: z.string().uuid().optional(),
      }),
    )
    .max(300),
  draft: experienceDraftSchema.nullable(),
  imageIds: z
    .array(z.string().uuid())
    .max(3)
    .refine((ids) => new Set(ids).size === ids.length),
  followUps: z.number().int().min(0).max(3),
  lookups: z
    .array(
      z.object({
        reply: text(50000),
        at: stamp,
        sources: z
          .array(
            z.object({
              title: text(500),
              url: z
                .string()
                .max(3000)
                .url()
                .refine(
                  (v) =>
                    v.startsWith('https://') &&
                    !new URL(v).username &&
                    !new URL(v).password,
                ),
              source: text(300),
              snippet: text(10000),
              publishedAt: stamp.nullable(),
              retrievedAt: stamp,
            }),
          )
          .max(10),
      }),
    )
    .max(100),
  steps: z
    .array(
      z.object({
        id: text(200),
        label: text(300),
        state: z.enum(['running', 'completed', 'failed']),
        query: text(300).optional(),
        at: stamp,
        resultCount: z.number().nonnegative().optional(),
      }),
    )
    .max(20),
  selection: z
    .object({ provider: z.enum(['chatgpt', 'workbuddy']), model: text(300) })
    .optional(),
  requests: z
    .array(
      z.object({
        id: z.string().uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        status: z.enum([
          'running',
          'completed',
          'failed',
          'cancelled',
          'interrupted',
        ]),
      }),
    )
    .max(100),
  error: text(2000).nullable(),
});
export class ExperienceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !z.string().uuid().safeParse(value).success)
    throw new ExperienceError('请求编号无效');
  return value;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new ExperienceError('请提供有效的修订号');
  return Number(value);
}
