export interface StatisticsFilters {
  taskType: 'all' | 'event' | 'todo' | 'reminder';
  reportSource: 'all' | 'local' | 'cloud';
}
export const DEFAULT_STATISTICS_FILTERS: StatisticsFilters = { taskType: 'all', reportSource: 'all' };
export function parseStatisticsFilters(value: unknown): StatisticsFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('统计筛选格式不正确');
  const input = value as Record<string, unknown>;
  if (typeof input.taskType !== 'string' || typeof input.reportSource !== 'string' || Object.keys(input).some(key => !['taskType', 'reportSource'].includes(key)) || !['all', 'event', 'todo', 'reminder'].includes(String(input.taskType)) || !['all', 'local', 'cloud'].includes(String(input.reportSource))) throw new Error('统计筛选格式不正确');
  return { taskType: input.taskType as StatisticsFilters['taskType'], reportSource: input.reportSource as StatisticsFilters['reportSource'] };
}
