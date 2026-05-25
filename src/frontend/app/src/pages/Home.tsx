import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../network/api';

export function Home() {
  const navigate = useNavigate();
  const [joinRoomId, setJoinRoomId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreateRoom = async () => {
    setCreating(true);
    setError(null);

    try {
      const room = await createRoom();
      navigate(`/room/${room.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinRoom = () => {
    const roomId = joinRoomId.trim();
    if (!roomId) {
      setError('请输入 roomId');
      return;
    }

    navigate(`/room/${roomId}`);
  };

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Cocanvas room lab</p>
        <h1>进入协作房间</h1>
        <p className="intro">
          创建一个房间，或者在两个浏览器窗口输入同一个 roomId，开始验证多人光标广播。
        </p>
      </section>

      <section className="echo-panel">
        <div className="room-actions">
          <button type="button" className="primary-action" onClick={handleCreateRoom} disabled={creating}>
            {creating ? 'Creating...' : 'Create room'}
          </button>
          <div className="join-controls">
            <input
              value={joinRoomId}
              placeholder="roomId"
              onChange={(event) => setJoinRoomId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleJoinRoom();
                }
              }}
            />
            <button type="button" onClick={handleJoinRoom}>Join</button>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
