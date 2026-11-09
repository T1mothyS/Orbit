export interface ActivityReportCardItem { id: string; title: string; date: string; href: string | null }
export interface ActivityReportCardData {
  reportId: string;
  start: string;
  end: string;
  timezone: string;
  completed: number;
  created: number;
  notes: number;
  overdue: number;
  backlog: number;
  completedItems: ActivityReportCardItem[];
  pendingItems: ActivityReportCardItem[];
  upcoming: ActivityReportCardItem[];
  insights: string[];
}
