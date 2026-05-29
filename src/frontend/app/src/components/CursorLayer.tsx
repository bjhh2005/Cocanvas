import { useMemo, type CSSProperties } from 'react';
import { useUserStore } from '../store/userStore';
import type { ViewportState } from './CanvasBoard';

type CursorLayerProps = {
  viewport: ViewportState;
};

export function CursorLayer({ viewport }: CursorLayerProps) {
  const remoteMap = useUserStore((state) => state.remotes);
  const remotes = useMemo(() => Object.values(remoteMap), [remoteMap]);

  return (
    <div className="cursor-layer" aria-label="Remote cursors">
      {remotes.map((peer) => (
        <div
          className="remote-cursor"
          key={peer.userId}
          style={{
            transform: `translate(${viewport.x + peer.x * viewport.scale}px, ${viewport.y + peer.y * viewport.scale}px)`,
            '--cursor-color': peer.color,
          } as CSSProperties}
        >
          <span className="cursor-dot" />
          <span className="cursor-name">{peer.displayName}</span>
        </div>
      ))}
    </div>
  );
}
