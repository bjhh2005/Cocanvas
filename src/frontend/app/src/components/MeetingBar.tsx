import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Bot, ChevronDown, ChevronUp, FileText, History, Mic, MicOff, Send, Smile, Sparkles } from 'lucide-react';
import type { MeetingPhase, MeetingPhaseId } from '../whiteboard/productBoard';
import type { HistoryAnchors } from '../network/api';

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
  color: string;
  onPhaseChange: (id: MeetingPhaseId) => void;
  onPhaseStep: (direction: 1 | -1) => void;
  // History
  historyAt: number;
  historyLoading: boolean;
  historyPreview: HistoryPreview | null;
  historyAnchors: HistoryAnchors | null;
  historyMode: boolean;
  onHistoryAtChange: (value: number) => void;
  onApplyHistory: (at: number) => void;
  onExitHistory: () => void;
  onHeightChange?: (height: number) => void;
  // Voice
  voiceEnabled: boolean;
  micEnabled: boolean;
  micError: string | null;
  onToggleMic: () => void;
  // AI
  onAiChat: (prompt: string) => Promise<{ message: string; ops: Array<Record<string, unknown>> }>;
  onAiSummarize: () => Promise<string>;
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

type AiMessage = {
  id: string;
  role: 'user' | 'ai';
  text: string;
  hasOps?: boolean;
  loading?: boolean;
  downloadUrl?: string;
  fileName?: string;
};


// ─── Component ────────────────────────────────────────────────────────────────

export function MeetingBar({
  phases,
  activePhaseId,
  activePhaseIndex,
  userId,
  color,
  onPhaseChange,
  onPhaseStep,
  historyAt,
  historyLoading,
  historyPreview,
  historyAnchors,
  historyMode,
  onHistoryAtChange,
  onApplyHistory,
  onExitHistory,
  onHeightChange,
  voiceEnabled,
  micEnabled,
  micError,
  onToggleMic,
  onAiChat,
  onAiSummarize,
  chatMessages,
  onSendMessage,
  onSendEmoji,
  remoteEmoji,
}: MeetingBarProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'flow' | 'chat' | 'history' | 'ai'>('flow');
  const [input, setInput] = useState('');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [historyNow, setHistoryNow] = useState(() => Date.now());
  const emojiTimersRef = useRef<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // AI tab state
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiListRef = useRef<HTMLDivElement>(null);
  const downloadUrlsRef = useRef<string[]>([]);

  const activePhase = phases.find((p) => p.id === activePhaseId) ?? phases[0];

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Auto-scroll AI chat to bottom
  useEffect(() => {
    if (aiListRef.current) {
      aiListRef.current.scrollTop = aiListRef.current.scrollHeight;
    }
  }, [aiMessages]);

  useEffect(() => () => {
    downloadUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    downloadUrlsRef.current = [];
  }, []);

  // Trigger float animation for remotely received emoji
  useEffect(() => {
    if (!remoteEmoji) return;
    const x = 10 + Math.random() * 80;
    const { id, emoji } = remoteEmoji;
    const addTimer = window.setTimeout(() => {
      setFloatingEmojis((prev) => [...prev, { id, emoji, x }]);
      const removeTimer = window.setTimeout(() => {
        setFloatingEmojis((prev) => prev.filter((e) => e.id !== id));
        emojiTimersRef.current = emojiTimersRef.current.filter((timer) => timer !== removeTimer);
      }, 2400);
      emojiTimersRef.current.push(removeTimer);
      emojiTimersRef.current = emojiTimersRef.current.filter((timer) => timer !== addTimer);
    }, 0);
    emojiTimersRef.current.push(addTimer);
  }, [remoteEmoji]);

  useEffect(() => () => {
    emojiTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    emojiTimersRef.current = [];
  }, []);

  useEffect(() => {
    if (tab !== 'history') return undefined;
    const refreshTimer = window.setTimeout(() => setHistoryNow(Date.now()), 0);
    const interval = window.setInterval(() => setHistoryNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(interval);
    };
  }, [tab]);

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

  const sendAiMessage = useCallback(async (promptText: string) => {
    const text = promptText.trim();
    if (!text || aiLoading) return;
    const userMsg: AiMessage = { id: uid(), role: 'user', text };
    const loadingMsg: AiMessage = { id: uid(), role: 'ai', text: '正在思考…', loading: true };
    setAiMessages((prev) => [...prev, userMsg, loadingMsg]);
    setAiInput('');
    setAiLoading(true);
    try {
      const res = await onAiChat(text);
      const hasOps = res.ops && res.ops.length > 0;
      setAiMessages((prev) =>
        prev.map((m) => m.id === loadingMsg.id
          ? { ...m, text: res.message, loading: false, hasOps }
          : m)
      );
    } catch {
      setAiMessages((prev) =>
        prev.map((m) => m.id === loadingMsg.id
          ? { ...m, text: '请求失败，请稍后重试。', loading: false }
          : m)
      );
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, onAiChat]);

  const handleAiSummarize = useCallback(async () => {
    if (aiLoading) return;
    const loadingMsg: AiMessage = { id: uid(), role: 'ai', text: '正在生成会议总结…', loading: true };
    setAiMessages((prev) => [...prev, loadingMsg]);
    setAiLoading(true);
    try {
      const summary = await onAiSummarize();
      const blob = new Blob([summary], { type: 'text/markdown;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(blob);
      downloadUrlsRef.current.push(downloadUrl);
      const fileName = `会议总结_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')}.md`;
      setAiMessages((prev) =>
        prev.map((m) => m.id === loadingMsg.id
          ? { ...m, text: '会议总结已生成，点击下方链接下载 Markdown 文件。', loading: false, downloadUrl, fileName }
          : m)
      );
    } catch {
      setAiMessages((prev) =>
        prev.map((m) => m.id === loadingMsg.id
          ? { ...m, text: '总结生成失败，请稍后重试。', loading: false }
          : m)
      );
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, onAiSummarize]);

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
            {voiceEnabled && (
              <span className={`meeting-bar__mic-indicator${micEnabled ? ' active' : ''}`} title={micEnabled ? '麦克风开启' : '语音未加入'}>
                {micEnabled ? <Mic size={14} /> : <AudioLines size={14} />}
              </span>
            )}
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
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'ai'}
              className={`meeting-bar__ai-tab${tab === 'ai' ? ' active' : ''}`}
              onClick={() => setTab('ai')}
            >
              <Bot size={13} aria-hidden />
              AI 助手
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
              {(() => {
                const minTs = historyAnchors?.roomCreatedAt ?? (historyAt - 3_600_000);
                const maxTs = historyAnchors?.latestOpAt ?? historyNow;
                const range = Math.max(maxTs - minTs, 1);
                const pct = (ts: number) => `${((ts - minTs) / range * 100).toFixed(2)}%`;

                const formatRelative = (ts: number) => {
                  const diff = historyNow - ts;
                  if (diff < 60_000) return '刚刚';
                  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
                  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
                  return new Date(ts).toLocaleString();
                };

                return (
                  <>
                    <div className="history-timeline">
                      <div className="history-timeline__labels">
                        <span>{new Date(minTs).toLocaleDateString()}</span>
                        <span className="history-timeline__selected-label">
                          <History size={13} aria-hidden />
                          {formatRelative(historyAt)} · {new Date(historyAt).toLocaleTimeString()}
                        </span>
                        <span>现在</span>
                      </div>

                      <div className="history-timeline__track">
                        {/* Snapshot tick marks */}
                        {historyAnchors?.snapshots.map((ts) => (
                          <span
                            key={ts}
                            className="history-timeline__tick"
                            style={{ left: pct(ts) }}
                            title={new Date(ts).toLocaleString()}
                          />
                        ))}
                        <input
                          type="range"
                          className="history-timeline__slider"
                          min={minTs}
                          max={maxTs}
                          step={1000}
                          value={historyAt}
                          onChange={(e) => onHistoryAtChange(Number(e.target.value))}
                          onPointerUp={(e) => {
                            const at = Number(e.currentTarget.value);
                            onHistoryAtChange(at);
                            onApplyHistory(at);
                          }}
                        />
                      </div>
                    </div>

                    {historyPreview && (
                      <div className="meeting-bar__history-result">
                        <span className="meeting-bar__history-badge">快照 {historyPreview.snapshotShapes} 个图形</span>
                        <span className="meeting-bar__history-badge">增量 {historyPreview.ops} 条操作</span>
                      </div>
                    )}

                    <div className="meeting-bar__history-actions">
                      <button
                        type="button"
                        className="meeting-bar__history-apply-btn"
                        onClick={() => onApplyHistory(historyAt)}
                        disabled={historyLoading}
                      >
                        {historyLoading ? '加载中…' : '在画布预览'}
                      </button>
                      {historyMode && (
                        <button
                          type="button"
                          className="meeting-bar__history-exit-btn"
                          onClick={onExitHistory}
                          disabled={historyLoading}
                        >
                          返回实时
                        </button>
                      )}
                    </div>

                    <p className="meeting-bar__history-tip">
                      拖动滑块选择时间点，快照刻度 <span className="history-tick-legend" /> 表示自动存档位置。
                    </p>
                  </>
                );
              })()}
            </div>
          )}
          {/* ── AI tab ── */}
          {tab === 'ai' && (
            <div className="meeting-bar__ai" role="tabpanel">
              {/* Quick action buttons */}
              <div className="meeting-bar__ai-actions">
                <button
                  type="button"
                  className="meeting-bar__ai-quick-btn"
                  onClick={() => void sendAiMessage(`当前会议阶段是"${phases.find(p => p.id === activePhaseId)?.label ?? '未知'}"，请根据阶段内容生成一组白板卡片，帮助团队推进讨论。复杂内容请自动拆成多个区域。`)}
                  disabled={aiLoading}
                >
                  <Sparkles size={13} aria-hidden />
                  智能生成当前阶段
                </button>
                <button
                  type="button"
                  className="meeting-bar__ai-quick-btn meeting-bar__ai-summary-btn"
                  onClick={handleAiSummarize}
                  disabled={aiLoading}
                >
                  <FileText size={13} aria-hidden />
                  生成会议总结
                </button>
              </div>

              {/* Message list */}
              <div className="meeting-bar__ai-list" ref={aiListRef}>
                {aiMessages.length === 0 && (
                  <div className="meeting-bar__ai-empty">
                    <Bot size={28} aria-hidden />
                    <p>你好！我是 AI 助手</p>
                    <p>可以帮你生成白板内容或总结会议结论</p>
                  </div>
                )}
                {aiMessages.map((msg) => (
                  <div key={msg.id} className={`meeting-bar__ai-msg meeting-bar__ai-msg--${msg.role}`}>
                    {msg.role === 'ai' && (
                      <span className="meeting-bar__ai-avatar">
                        <Bot size={14} />
                      </span>
                    )}
                    <div className="meeting-bar__ai-bubble">
                      {msg.loading
                        ? <span className="meeting-bar__ai-loading">⋯</span>
                        : <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                      }
                      {msg.hasOps && !msg.loading && (
                        <span className="meeting-bar__ai-ops-badge">
                          <Sparkles size={11} aria-hidden /> 已生成到画布
                        </span>
                      )}
                      {msg.downloadUrl && !msg.loading && (
                        <a
                          href={msg.downloadUrl}
                          download={msg.fileName}
                          className="meeting-bar__ai-download-link"
                        >
                          <FileText size={13} aria-hidden />
                          {msg.fileName}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Input row */}
              <div className="meeting-bar__ai-input-row">
                <input
                  className="meeting-bar__ai-input"
                  type="text"
                  placeholder="告诉 AI 要生成什么内容…"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendAiMessage(aiInput); } }}
                  disabled={aiLoading}
                  maxLength={500}
                />
                <button
                  type="button"
                  className="meeting-bar__ai-send-btn"
                  onClick={() => void sendAiMessage(aiInput)}
                  disabled={!aiInput.trim() || aiLoading}
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Voice control bar (always visible when voice enabled) ── */}
          {voiceEnabled && (
            <div className="meeting-bar__voice">
              <AudioLines size={15} aria-hidden />
              <span className="meeting-bar__voice-label">
                {micEnabled ? '麦克风已开启' : '会议语音'}
              </span>
              <button
                type="button"
                className={`meeting-bar__voice-btn${micEnabled ? ' active' : ''}`}
                onClick={onToggleMic}
              >
                {micEnabled ? <MicOff size={14} /> : <Mic size={14} />}
                {micEnabled ? '静音' : '加入语音'}
              </button>
              {micError && <em className="meeting-bar__voice-error">{micError}</em>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
