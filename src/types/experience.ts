import type { NoteImage } from '../utils/note-images';
export interface AiStep {
  id: string;
  label: string;
  state: 'running' | 'completed' | 'failed';
  query?: string;
  at: string;
  resultCount?: number;
}
export interface WebSource {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: string | null;
  retrievedAt: string;
}
export interface ExperienceMetadata {
  schemaVersion: 1;
  subtype: 'travel' | 'other';
  time: {
    description: string;
    start?: string;
    end?: string;
  };
  places: string[];
  impression: string;
  rating?: {
    value: number;
    scale?: number;
    description: string;
  };
  repeatIntent: 'yes' | 'no' | 'conditional' | 'unknown';
  audienceNotes: string[];
  lessons: string[];
  imageIds: string[];
}
export interface ExperienceDraft {
  title: string;
  summary: string;
  content: string;
  tags: string[];
  experience: ExperienceMetadata;
}
export interface ExperienceMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  requestId?: string;
}
export interface ExperienceLookup {
  reply: string;
  sources: WebSource[];
  at: string;
}
export interface ExperienceData {
  messages: ExperienceMessage[];
  draft: ExperienceDraft | null;
  imageIds: string[];
  followUps: number;
  lookups: ExperienceLookup[];
  steps: AiStep[];
  selection?: {
    provider: 'chatgpt' | 'workbuddy';
    model: string;
  };
  requests: Array<{
    id: string;
    fingerprint: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  }>;
  error: string | null;
}
export interface ExperienceSession {
  id: string;
  entryId: string | null;
  revision: number;
  state: 'collecting' | 'generating' | 'ready' | 'saved';
  createdAt: string;
  updatedAt: string;
  data: ExperienceData;
  images: NoteImage[];
}
export const emptyExperience = (): ExperienceMetadata => ({
  schemaVersion: 1,
  subtype: 'travel',
  time: { description: '' },
  places: [],
  impression: '',
  repeatIntent: 'unknown',
  audienceNotes: [],
  lessons: [],
  imageIds: [],
});
