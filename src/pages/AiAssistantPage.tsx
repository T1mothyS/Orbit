import { Check, Eraser, Loader2, StickyNote } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AiNoteBoardHost, useAiNoteBoard } from '../components/AiNoteBoardHost';
import { AiSchedulePanel, type AiSchedulePanelHandle } from '../components/AiSchedulePanel';
import { Button, useActionConfirmation } from '../ui';

import { OrbitScheduleEditor } from '../components/OrbitScheduleEditor';

export function AiAssistantPage() {
  const [searchParams] = useSearchParams();

  const chatPanelRef = useRef<AiSchedulePanelHandle>(null);
  const [openScheduleId, setOpenScheduleId] = useState<string | null>(null);
  const [chatError,setChatError]=useState('');
  const confirmation = useActionConfirmation();
  const [chatState, setChatState] = useState({ hasMessages: false, busy: false, clearDisabled: true });
  const noteBoard = useAiNoteBoard({
    initialNoteId: searchParams.get('note') || undefined,
  });
  const saveNote = useCallback((content: string, imageIds?: string[]) => noteBoard.createNote(content, imageIds), [noteBoard.createNote]);

  const clearKey = `clear:${searchParams.get('conversation') || ''}`;
  const clearing = confirmation.busy === clearKey;
  const resetDisabled = chatState.clearDisabled || !!confirmation.busy;
  const resetTitle = clearing ? '正在清空…' : '清空当前对话';

  return (
    <div className="ai-assistant-page">{confirmation.dialog}
      <div className="ai-assistant-page-main">
        <header className="ai-assistant-topbar">
          <div className="ai-assistant-topbar-title">
            <span className="eyebrow">ORBIT</span>
            <strong>个人事务中心</strong>
          </div>

          <div className="ai-assistant-topbar-actions">
            <Button
              type="button"
              className="ai-workspace-action"
              data-confirm-action={clearKey}
              onClick={() => { void confirmation.run({key:clearKey,title:'清空当前对话？',description:'当前对话的历史记录将被清空，此操作无法撤销。',confirmLabel:'清空对话'}, async () => { setChatError(''); await chatPanelRef.current?.clearCurrentConversation(); }); }}
              disabled={resetDisabled}
              title={resetTitle}
              aria-label={resetTitle}
            >
              {clearing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Eraser size={16} aria-hidden="true" />}
              <span>{resetTitle}</span>
            </Button>
            <button
              type="button"
              className="ai-workspace-action ai-workspace-note-action"
              onClick={noteBoard.toggleDrawer}
              aria-expanded={noteBoard.drawerOpen}
              aria-controls="ai-note-board"
              title="打开 AI 记事板"
              aria-label="打开 AI 记事板"
            >
              <StickyNote size={16} aria-hidden="true" />
              <span>记事板</span>
              {noteBoard.pendingCount > 0 && <em aria-label={`${noteBoard.pendingCount} 条未完成记事`}>{noteBoard.pendingCount}</em>}
            </button>
          </div>
        </header>
        <section
          id="ai-panel-content"
          className="ai-assistant-tool-content"
          aria-label="AI 对话"
        >
            <div className="ai-schedule-page">
              <section className="ai-schedule-page-card">
                <AiSchedulePanel
                  ref={chatPanelRef}
                  onSaveNote={saveNote}
                  onOpenSchedule={setOpenScheduleId}
                  confirmation={confirmation}
                  onChatStateChange={setChatState}
                />
              </section>
            </div>
        </section>
      </div>
      <AiNoteBoardHost controller={noteBoard} />
      {chatError&&<div className="orbit-error" role="alert">{chatError}<button type="button" onClick={()=>setChatError('')}>关闭</button></div>}
      {openScheduleId && <OrbitScheduleEditor id={openScheduleId} onClose={() => setOpenScheduleId(null)} onSaved={() => {void chatPanelRef.current?.refresh();}} onChat={(id,title)=>{void chatPanelRef.current?.startConversation(id,title).then(()=>setOpenScheduleId(null)).catch(e=>setChatError(e.message));}} />}
    </div>
  );
}
