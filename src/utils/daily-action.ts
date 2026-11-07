export type DailyActionWeather =
  | { state: 'unconfigured' }
  | { state: 'unavailable'; place: string }
  | { state: 'available'; place: string; code: number; description: string; low: number | null; high: number | null; rain: number | null; cached: boolean };

export interface DailyActionMeta {
  date: string;
  weather: DailyActionWeather;
}
