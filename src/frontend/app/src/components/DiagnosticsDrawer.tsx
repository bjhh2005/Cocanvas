import { Activity, Server, X } from 'lucide-react';
import type { CacheStatsResponse, QueueStatsResponse } from '../network/api';

type DiagnosticsDrawerProps = {
  connectedNode: string;
  status: string;
  wsUrl: string;
  reconnectAttempts: number;
  pendingOpsCount: number;
  lastRestoredOps: number;
  lastReplayedOps: number;
  lastFlushedOps: number;
  cacheStats: CacheStatsResponse | null;
  queueStats: QueueStatsResponse | null;
  onClose: () => void;
};

const metric = (label: string, value: string | number) => (
  <div className="diagnostics-metric">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export function DiagnosticsDrawer({
  connectedNode,
  status,
  wsUrl,
  reconnectAttempts,
  pendingOpsCount,
  lastRestoredOps,
  lastReplayedOps,
  lastFlushedOps,
  cacheStats,
  queueStats,
  onClose,
}: DiagnosticsDrawerProps) {
  return (
    <div className="panel-overlay diagnostics-overlay" role="dialog" aria-modal="true" aria-label="Collaboration diagnostics" onClick={onClose}>
      <section className="diagnostics-drawer" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <Activity size={18} aria-hidden />
            <strong>Diagnostics</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close diagnostics"><X size={16} aria-hidden /></button>
        </header>

        <div className="diagnostics-section">
          <h3><Server size={15} aria-hidden /> Session</h3>
          <div className="diagnostics-grid">
            {metric('Status', status)}
            {metric('Node', connectedNode)}
            {metric('Reconnects', reconnectAttempts)}
            {metric('Pending ops', pendingOpsCount)}
          </div>
          <code>{wsUrl || 'No WebSocket URL yet'}</code>
        </div>

        <div className="diagnostics-section">
          <h3>Recovery</h3>
          <div className="diagnostics-grid">
            {metric('Restored', lastRestoredOps)}
            {metric('Replayed', lastReplayedOps)}
            {metric('Flushed', lastFlushedOps)}
          </div>
        </div>

        <div className="diagnostics-section">
          <h3>Backend</h3>
          <div className="diagnostics-grid">
            {metric('Cache hit', cacheStats ? `${(cacheStats.hitRate * 100).toFixed(1)}%` : 'n/a')}
            {metric('Cache miss', cacheStats?.missCount ?? 'n/a')}
            {metric('Queue', queueStats?.totalQueuedMessages ?? 'n/a')}
            {metric('Drops', queueStats?.transientDrops ?? 'n/a')}
          </div>
        </div>
      </section>
    </div>
  );
}
