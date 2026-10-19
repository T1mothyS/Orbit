import { CalendarClock, Check, Clock3 } from 'lucide-react';
import { IconButton, Tooltip } from '../ui';

const actions = [
  { action: 'complete', label: '完成事项', Icon: Check },
  { action: 'snooze', label: '延后 15 分钟', Icon: Clock3 },
  { action: 'tomorrow', label: '明天 09:00 再提醒', Icon: CalendarClock },
] as const;

export function ReminderActionButtons({ busy, onAction }: { busy: boolean; onAction: (action: string) => void }) {
  return <>{actions.map(({ action, label, Icon }) => <Tooltip key={action} content={label}>
    <IconButton label={label} variant="quiet" size="small" disabled={busy} onClick={() => onAction(action)}><Icon size={16} strokeWidth={1.8} aria-hidden="true" /></IconButton>
  </Tooltip>)}</>;
}
