export type DailyActionWeather =
  | { state: 'unconfigured' }
  | { state: 'unavailable'; place: string }
  | { state: 'available'; place: string; code: number; description: string; low: number | null; high: number | null; rain: number | null; cached: boolean };

export interface DailyActionMeta {
  date: string;
  weather: DailyActionWeather;
  schemaVersion?: 1;
  capturedAt?: string;
  timezone?: string;
  items?: DailyActionItem[];
  /** Old records did not retain full item facts and cannot be reconstructed as snapshots. */
  legacy?: boolean;
}

export interface DailyActionItem {
  id: string;
  sourceType: 'schedule' | 'reminder';
  sourceId: string;
  instanceId: string | null;
  scheduleId: string | null;
  type: 'event' | 'todo' | 'reminder';
  title: string;
  startTime: string;
  endTime: string | null;
  dueDate: string | null;
  allDay: boolean;
  completed: boolean;
  /** Recomputed at read time; never used as the historical fact or mutation authorization. */
  current?: {
    available: boolean;
    completed: boolean;
    editable: boolean;
    scheduleId: string | null;
    href: string | null;
  };
}

export interface DailyActionSnapshot {
  date: string;
  timezone: string;
  capturedAt: string;
  items: DailyActionItem[];
}
