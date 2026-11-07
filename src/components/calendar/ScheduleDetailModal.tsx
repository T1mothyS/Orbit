import { Button, IconButton, Tooltip, useActionConfirmation } from '../../ui';
import { Check, Clock, Edit3, MapPin, Trash2, Undo2, X } from 'lucide-react';
import { CATEGORY_LABELS, formatTime, PRIORITY_COLORS } from './schedule-presentation';
import type { CompletionProofDisplay, Schedule } from './schedule-types';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDialogLifecycle } from '../../hooks/useDialogLifecycle';

export function ScheduleDetailModal({
  schedule,
  onClose,
  onDelete,
  onToggle,
  onEdit,
  closeAfterAction = true,
  completionProof,
  onEditCompletion,
  extraActions,
}: {
  schedule: Schedule;
  onClose: () => void;
  onDelete: (id: string) => void | boolean | Promise<void | boolean>;
  onToggle: (id: string) => void | boolean | Promise<void | boolean>;
  onEdit: (s: Schedule) => void;
  closeAfterAction?: boolean;
  completionProof?: CompletionProofDisplay | null;
  onEditCompletion?: () => void;
  extraActions?:ReactNode;
}) {
  const confirmation = useActionConfirmation();
  const pColor = PRIORITY_COLORS[schedule.priority] || PRIORITY_COLORS.medium;
  const dialogRef=useRef<HTMLDialogElement>(null);
  useDialogLifecycle(dialogRef, true, '[aria-label="关闭事项详情"]');
  const actionRef = useRef(false);
  const actionFocus = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => { if (!busy && actionFocus.current?.isConnected) { actionFocus.current.focus({preventScroll:true}); actionFocus.current = null; } }, [busy]);
  const [error, setError] = useState('');
  const dismiss = () => { if (!actionRef.current) onClose(); };
  const runAction = async (action: typeof onDelete) => {
    if (actionRef.current) return;
    actionFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actionRef.current = true; setBusy(true); setError('');
    try { const result = await action(schedule.id); if (result === false) throw new Error('操作未完成，事项已保留，请稍后重试。'); if (closeAfterAction) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); return false; }
    finally { actionRef.current = false; setBusy(false); }
  };

  const completionLabel = schedule.is_completed ? '标记未完成' : '标记完成';
  const category = CATEGORY_LABELS[schedule.category];
  const kindLabel = schedule.type === 'todo' ? '待办' : '日程';

  return (
    <dialog ref={dialogRef} aria-label={schedule.title}
      className="orbit-dialog-viewport fixed inset-0 z-50 flex items-center justify-center"
      onCancel={event => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={event => { if (event.target === event.currentTarget) dismiss(); }}
    >
      {confirmation.dialog}
      <div
        className="schedule-detail-surface rounded-2xl p-5 shadow-2xl"
        data-schedule-kind={schedule.type}
        style={{ backgroundColor: 'var(--td-bg-color-container)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="schedule-detail-header mb-3">
          <div className="schedule-detail-heading">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="schedule-detail-kind text-xs px-2 py-0.5 rounded-full font-medium">
                {schedule.type === 'event' && category ? `${kindLabel} · ${category}` : kindLabel}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${pColor.dot}18`, color: pColor.dot }}>
                {PRIORITY_COLORS[schedule.priority]?.label || '中优先'}
              </span>
            </div>
            <h3 className="schedule-title-primary text-base font-bold">{schedule.title}</h3>
          </div>
          <div className="schedule-detail-tools">
            <div className="orbit-chat-detail-actions" role="group" aria-label="事项操作">
              <Tooltip content="删除" portalContainer={dialogRef}>
                <IconButton label="删除" variant="quiet" disabled={busy}
                  onClick={event => void confirmation.run({ title: '删除日程？', description: `确定删除“${schedule.title}”吗？删除后无法撤销。`, confirmLabel: '删除日程', kind: 'popover', anchor: event.currentTarget, portalContainer: dialogRef.current }, () => runAction(onDelete))}>
                  <Trash2 className="orbit-chat-detail-delete" size={19} aria-hidden="true" />
                </IconButton>
              </Tooltip>
              <Tooltip content={completionLabel} portalContainer={dialogRef}>
                <IconButton label={completionLabel} variant="quiet" disabled={busy} aria-pressed={schedule.is_completed} onClick={() => void runAction(onToggle)}>
                  <span className="orbit-chat-detail-check">
                    {schedule.is_completed ? <Undo2 size={19} aria-hidden="true" /> : <Check size={21} strokeWidth={2.4} aria-hidden="true" />}
                  </span>
                </IconButton>
              </Tooltip>
              <Tooltip content="编辑" portalContainer={dialogRef}>
                <IconButton label="编辑" variant="quiet" disabled={busy} className="schedule-detail-edit"
                  onClick={() => { onEdit(schedule); if (closeAfterAction) onClose(); }}>
                  <Edit3 size={19} aria-hidden="true" />
                </IconButton>
              </Tooltip>
            </div>
            <IconButton label="关闭事项详情" variant="quiet" disabled={busy} onClick={dismiss} className="schedule-detail-close">
              <X size={19} aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div className="schedule-detail-body space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
            <Clock className="w-4 h-4" />
            {schedule.all_day
              ? '全天'
              : `${formatTime(schedule.start_time)}${schedule.end_time ? ' - ' + formatTime(schedule.end_time) : ''}`
            }
          </div>
          {schedule.location && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              <MapPin className="w-4 h-4" />
              {schedule.location}
            </div>
          )}
          {schedule.notes && (
            <div className="mt-2 p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}>
              备注：{schedule.notes}
            </div>
          )}
          {schedule.description && (
            <div className="text-sm mt-2" style={{ color: 'var(--td-text-color-secondary)' }}>
              {schedule.description}
            </div>
          )}
          {completionProof && (
            <div className="mt-2 p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}>
              <strong style={{ color: 'var(--td-text-color-primary)' }}>完成记录</strong>
              {completionProof.note && <div className="mt-1">备注：{completionProof.note}</div>}
              {completionProof.amountCents != null && <div className="mt-1">金额：{(completionProof.amountCents / 100).toFixed(2)} {completionProof.currency}</div>}
              {completionProof.billDate && <div className="mt-1">账单日：{completionProof.billDate}</div>}
              {completionProof.attachments.length > 0 && <div className="mt-1">附件：{completionProof.attachments.map(file => file.originalName).join('、')}</div>}
            </div>
          )}
        </div>

        {error && <p className="orbit-inline-error" role="alert">{error}</p>}
        {extraActions}
        {onEditCompletion && <div className="schedule-detail-actions">
          <Button variant="quiet" disabled={busy} onClick={onEditCompletion}
            leadingIcon={<Edit3 size={16} aria-hidden="true" />}>编辑完成记录</Button>
        </div>}
      </div>
    </dialog>
  );
}
