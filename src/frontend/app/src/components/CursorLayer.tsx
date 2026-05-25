import type { CSSProperties } from 'react';
import { useUserStore } from '../store/userStore';

export function CursorLayer() {
  const remotes = useUserStore((state) => Object.values(state.remotes));

  return (
    <div className="cursor-layer" aria-label="Remote cursors">
      {remotes.map((peer) => (
        <div
          className="remote-cursor"
          key={peer.userId}
          style={{
            transform: `translate(${peer.x}px, ${peer.y}px)`,
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
