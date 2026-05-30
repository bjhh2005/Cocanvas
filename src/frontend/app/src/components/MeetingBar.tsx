import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, History, Send, Smile } from 'lucide-react';
import type { MeetingPhase, MeetingPhaseId } from '../whiteboard/productBoard';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  color: string;
  text: string;
  timestamp: number;
}

interface FloatingEmoji {
  id: string;
  emoji: string;
  x: number;
}

interface HistoryPreview {
  snapshotId: string;
  snapshotShapes: number;
  ops: number;
  at: number;
}

interface MeetingBarProps {
  phases: MeetingPhase[];
  activePhaseId: MeetingPhaseId;
  activePhaseIndex: number;
  userId: string;
  displayName: string;
  color: string;
  onPhaseChange: (id: MeetingPhaseId) => void;
  onPhaseStep: (direction: number) => void;
  // History
  historyAt: number;
  historyLoading: boolean;
  historyPreview: HistoryPreview | null;
  onHistoryAtChange: (value: number) => void;
  onLoadHistory: () => void;
  onHeightChange?: (height: number) => void;
  // Synced state
  chatMessages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onSendEmoji: (emoji: string) => void;
  remoteEmoji: { id: string; emoji: string } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_LIST = ['😄', '👍', '🔥', '❤️', '💡', '🎉', '😮', '👏'];

let _msgId = 0;
const uid = () => `msg-${Date.now()}-${++_msgId}`;

const formatDatetimeLocal = (ts: number) => {
  const d = new Date(ts);
  // datetime-local input expects "YYYY-MM-DDTHH:mm"
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function MeetingBar({
  phases,
  activePhaseId,
  activePhaseIndex,
  userId,
  displayName,
  color,
  onPhaseChange,
  onPhaseStep,
  historyAt,
  historyLoading,
  historyPreview,
  onHistoryAtChange,
  onLoadHistory,
  onHeightChange,
  chatMessages,
  onSendMessage,
  onSendEmoji,
  remoteEmoji,
}: MeetingBarProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'flow' | 'chat' | 'history'>('flow');
  const [input, setInput] = useState('');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const activePhase = phases.find((p) => p.id === activePhaseId) ?? phases[0];

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Trigger float animation for remotely received emoji
  useEffect(() => {
    if (!remoteEmoji) return;
    const x = 10 + Math.random() * 80;
    const { id, emoji } = remoteEmoji;
    setFloatingEmojis((prev) => [...prev, { id, emoji, x }]);
    const t = setTimeout(() => setFloatingEmojis((prev) => prev.filter((e) => e.id !== id)), 2400);
    return () => clearTimeout(t);
  }, [remoteEmoji]);

  // Report bar height to parent so sidebars can shrink accordingly
  useEffect(() => {
    if (!barRef.current || !onHeightChange) return;
    const el = barRef.current;
    const notify = () => onHeightChange(el.offsetHeight);
    notify();
    const ro = new ResizeObserver(notify);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    onSendMessage(text);
    setInput('');
    inputRef.current?.focus();
  }, [input, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const launchEmoji = useCallback((emoji: string) => {
    // Local float
    const x = 10 + Math.random() * 80;
    const id = uid();
    setFloatingEmojis((prev) => [...prev, { id, emoji, x }]);
    setTimeout(() => setFloatingEmojis((prev) => prev.filter((e) => e.id !== id)), 2400);
    setEmojiPickerOpen(false);
    // Broadcast to others
    onSendEmoji(emoji);
  }, [onSendEmoji]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const handleDatetimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ts = new Date(e.target.value).getTime();
    if (!isNaN(ts)) onHistoryAtChange(ts);
  };

  return (
    <>
      {/* Floating emoji layer */}
      <div className="meeting-emoji-layer" aria-hidden>
        {floatingEmojis.map((fe) => (
          <span key={fe.id} className="meeting-emoji-float" style={{ left: `${fe.x}%` }}>
            {fe.emoji}
          </span>
        ))}
      </div>

      <div ref={barRef} className={`meeting-bar${open ? ' meeting-bar--open' : ''}`}>
        {/* ── Handle / collapsed strip ── */}
        <button
          type="button"
          className="meeting-bar__handle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? '收起会议面板' : '展开会议面板'}
        >
          <div className="meeting-bar__handle-left">
            <span className="meeting-bar__phase-dot" style={{ background: color }} />
            <span className="meeting-bar__phase-name">{activePhase?.label}</span>
            <span className="meeting-bar__phase-step">
              {activePhaseIndex + 1} / {phases.length}
            </span>
          </div>
          <div className="meeting-bar__handle-right">
            {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </div>
        </button>

        {/* ── Expanded panel ── */}
        <div className="meeting-bar__panel">
          {/* Tab switcher */}
          <div className="meeting-bar__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'flow'}
              className={tab === 'flow' ? 'active' : ''}
              onClick={() => setTab('flow')}
            >
              会议进程
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'chat'}
              className={tab === 'chat' ? 'active' : ''}
              onClick={() => setTab('chat')}
            >
              对话框
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              className={tab === 'history' ? 'active' : ''}
              onClick={() => setTab('history')}
            >
              历史回放
            </button>
          </div>

          {/* ── Meeting flow tab ── */}
          {tab === 'flow' && (
            <div className="meeting-bar__flow" role="tabpanel">
              <div className="meeting-bar__phase-track" aria-label="会议阶段">
                {phases.map((phase, idx) => (
                  <button
                    key={phase.id}
                    type="button"
                    className={`meeting-bar__phase-chip${phase.id === activePhaseId ? ' active' : ''}`}
                    onClick={() => onPhaseChange(phase.id)}
                    title={phase.hint}
                  >
                    <span className="meeting-bar__chip-num">{idx + 1}</span>
                    <span className="meeting-bar__chip-label">{phase.label}</span>
                  </button>
                ))}
              </div>

              {activePhase && (
                <p className="meeting-bar__phase-hint">{activePhase.hint}</p>
              )}

              <div className="meeting-bar__flow-actions">
                <button
                  type="button"
                  onClick={() => onPhaseStep(-1)}
                  disabled={activePhaseIndex <= 0}
                >
                  ← 上一阶段
                </button>
                <button
                  type="button"
                  onClick={() => onPhaseStep(1)}
                  disabled={activePhaseIndex >= phases.length - 1}
                >
                  下一阶段 →
                </button>
              </div>
            </div>
          )}

          {/* ── Chat tab ── */}
          {tab === 'chat' && (
            <div className="meeting-bar__chat" role="tabpanel">
              <div className="meeting-bar__message-list" ref={listRef}>
                {chatMessages.length === 0 && (
                  <p className="meeting-bar__chat-empty">还没有消息，说点什么吧 👋</p>
                )}
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`meeting-bar__message${msg.userId === userId ? ' mine' : ''}`}
                  >
                    <span
                      className="meeting-bar__msg-avatar"
                      style={{ background: msg.color }}
                      title={msg.displayName}
                    >
                      {msg.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="meeting-bar__msg-body">
                      <span className="meeting-bar__msg-name">{msg.displayName}</span>
                      <span className="meeting-bar__msg-text">{msg.text}</span>
                    </div>
                    <span className="meeting-bar__msg-time">{formatTime(msg.timestamp)}</span>
                  </div>
                ))}
              </div>

              <div className="meeting-bar__input-row">
                <div className="meeting-bar__emoji-wrap">
                  <button
                    type="button"
                    className="meeting-bar__emoji-btn"
                    onClick={() => setEmojiPickerOpen((v) => !v)}
                    title="发送表情"
                    aria-label="选择表情"
                  >
                    <Smile size={18} />
                  </button>
                  {emojiPickerOpen && (
                    <div className="meeting-bar__emoji-picker">
                      {EMOJI_LIST.map((e) => (
                        <button key={e} type="button" onClick={() => launchEmoji(e)} title={e}>
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <input
                  ref={inputRef}
                  className="meeting-bar__text-input"
                  type="text"
                  placeholder="说点什么…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={300}
                />
                <button
                  type="button"
                  className="meeting-bar__send-btn"
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  title="发送 (Enter)"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ── History tab ── */}
          {tab === 'history' && (
            <div className="meeting-bar__history" role="tabpanel">
              <div className="meeting-bar__history-controls">
                <History size={16} className="meeting-bar__history-icon" aria-hidden />
                <label htmlFor="mb-history-at" className="meeting-bar__history-label">
                  选择时间点
                </label>
                <input
                  id="mb-history-at"
                  type="datetime-local"
                  className="meeting-bar__history-input"
                  value={formatDatetimeLocal(historyAt)}
                  onChange={handleDatetimeChange}
                />
                <button
                  type="button"
                  className="meeting-bar__history-load-btn"
                  onClick={onLoadHistory}
                  disabled={historyLoading}
                >
                  {historyLoading
                    ? <><Download size={15} aria-hidden /> 加载中…</>
                    : <><History size={15} aria-hidden /> 查看历史</>
                  }
                </button>
              </div>

              {historyPreview && (
                <div className="meeting-bar__history-result">
                  <span className="meeting-bar__history-badge">
                    快照 {historyPreview.snapshotShapes} 个图形
                  </span>
                  <span className="meeting-bar__history-badge">
                    增量 {historyPreview.ops} 条操作
                  </span>
                  <span className="meeting-bar__history-time">
                    {new Date(historyPreview.at).toLocaleString()}
                  </span>
                </div>
              )}

              <p className="meeting-bar__history-tip">
                选择历史时间点可预览该时刻的画布状态，不会影响当前协作内容。
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
