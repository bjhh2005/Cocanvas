import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  DoorOpen,
  Hash,
  Headphones,
  KeyRound,
  LoaderCircle,
  Lock,
  Pencil,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  archiveRoom,
  createRoom,
  listRooms,
  updateRoom,
  type RoomSummary,
} from '../network/api';
import { UserIdentityEditor } from '../components/UserIdentityEditor';

type RoomFormState = {
  roomId: string;
  name: string;
  accessMode: string;
  permissionMode: string;
  password: string;
  voiceEnabled: boolean;
};

const emptyForm: RoomFormState = {
  roomId: '',
  name: '',
  accessMode: 'link',
  permissionMode: 'edit',
  password: '',
  voiceEnabled: true,
};

const formatTime = (value: number) => value > 0
  ? new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
  : '-';

const permissionLabel = (mode: string) => {
  if (mode === 'view') {
    return '只读';
  }
  if (mode === 'comment') {
    return '可评论';
  }
  return '可编辑';
};

export function Home() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [form, setForm] = useState<RoomFormState>(emptyForm);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const editingRoom = useMemo(
    () => editingRoomId ? rooms.find((room) => room.roomId === editingRoomId) ?? null : null,
    [editingRoomId, rooms]
  );

  const loadRooms = useCallback(async () => {
    setLoadingRooms(true);
    setError(null);
    try {
      setRooms(await listRooms());
      setLastRefreshedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载房间失败');
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRooms();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRooms]);

  const resetForm = () => {
    setEditingRoomId(null);
    setForm(emptyForm);
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      if (editingRoom) {
        await updateRoom(editingRoom.roomId, {
          name: form.name,
          accessMode: form.accessMode,
          permissionMode: form.permissionMode,
          password: form.password || undefined,
          voiceEnabled: form.voiceEnabled,
        });
        resetForm();
        await loadRooms();
        return;
      }

      const room = await createRoom({
        roomId: form.roomId || undefined,
        name: form.name || undefined,
        accessMode: form.accessMode,
        permissionMode: form.permissionMode,
        password: form.password || undefined,
        voiceEnabled: form.voiceEnabled,
      });
      await loadRooms();
      navigate(`/room/${room.roomId}${form.password ? `?password=${encodeURIComponent(form.password)}` : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存房间失败');
    } finally {
      setSaving(false);
    }
  };

  const handleJoinRoom = () => {
    const roomId = joinRoomId.trim();
    if (!roomId) {
      setError('请输入房间号');
      return;
    }

    navigate(`/room/${roomId}${joinPassword ? `?password=${encodeURIComponent(joinPassword)}` : ''}`);
  };

  const beginEdit = (room: RoomSummary) => {
    setEditingRoomId(room.roomId);
    setForm({
      roomId: room.roomId,
      name: room.name,
      accessMode: room.accessMode,
      permissionMode: room.permissionMode,
      password: '',
      voiceEnabled: room.voiceEnabled,
    });
  };

  const handleArchive = async (roomId: string) => {
    setError(null);
    try {
      await archiveRoom(roomId);
      if (editingRoomId === roomId) {
        resetForm();
      }
      await loadRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档房间失败');
    }
  };

  return (
    <main className="room-console">
      <header className="console-header">
        <div>
          <p className="eyebrow">Cocanvas rooms</p>
          <h1>协作房间控制台</h1>
          <p>把白板当成会议空间来管理：房间号、密码、权限、语音入口和历史房间都在这里。</p>
        </div>
        <div className="console-actions">
          <UserIdentityEditor />
          <div className="refresh-stack">
            <button type="button" className="ghost-action" onClick={() => void loadRooms()} disabled={loadingRooms}>
              {loadingRooms ? <LoaderCircle size={16} className="spin-icon" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
              <span>{loadingRooms ? '刷新中' : '刷新'}</span>
            </button>
            <span>{lastRefreshedAt ? `上次 ${formatTime(lastRefreshedAt)}` : '尚未刷新'}</span>
          </div>
        </div>
      </header>

      <section className="room-console-grid">
        <form
          className="room-form-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <header>
            <strong>{editingRoom ? '管理房间' : '创建房间'}</strong>
            {editingRoom && <button type="button" onClick={resetForm}>取消编辑</button>}
          </header>

          <label>
            <span>房间名称</span>
            <input
              value={form.name}
              placeholder="例如：产品头脑风暴"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label>
            <span>房间号</span>
            <input
              value={form.roomId}
              placeholder="留空自动生成，也可以填 sprint-demo"
              disabled={Boolean(editingRoom)}
              onChange={(event) => setForm((current) => ({ ...current, roomId: event.target.value }))}
            />
          </label>

          <div className="field-row">
            <label>
              <span>进入方式</span>
              <select
                value={form.accessMode}
                onChange={(event) => setForm((current) => ({ ...current, accessMode: event.target.value }))}
              >
                <option value="link">知道链接即可进入</option>
                <option value="password">需要密码</option>
                <option value="private">仅主持人邀请</option>
              </select>
            </label>
            <label>
              <span>默认权限</span>
              <select
                value={form.permissionMode}
                onChange={(event) => setForm((current) => ({ ...current, permissionMode: event.target.value }))}
              >
                <option value="edit">可编辑</option>
                <option value="comment">可评论</option>
                <option value="view">只读</option>
              </select>
            </label>
          </div>

          <label>
            <span>{editingRoom ? '新密码' : '房间密码'}</span>
            <input
              type="password"
              value={form.password}
              placeholder={editingRoom ? '留空则保持原密码' : '可选'}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={form.voiceEnabled}
              onChange={(event) => setForm((current) => ({ ...current, voiceEnabled: event.target.checked }))}
            />
            <span>启用会议语音入口</span>
          </label>

          <button type="submit" className="primary-action" disabled={saving}>
            {saving ? <LoaderCircle size={18} className="spin-icon" aria-hidden /> : <PlusCircle size={18} aria-hidden />}
            <span>{editingRoom ? '保存设置' : '创建并进入'}</span>
          </button>
        </form>

        <section className="join-panel">
          <header>
            <DoorOpen size={18} aria-hidden />
            <strong>快速进入</strong>
          </header>
          <div className="join-stack">
            <input
              value={joinRoomId}
              placeholder="房间号"
              onChange={(event) => setJoinRoomId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleJoinRoom();
                }
              }}
            />
            <input
              type="password"
              value={joinPassword}
              placeholder="密码，可选"
              onChange={(event) => setJoinPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleJoinRoom();
                }
              }}
            />
            <button type="button" onClick={handleJoinRoom}>
              <DoorOpen size={17} aria-hidden />
              <span>进入房间</span>
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </section>
      </section>

      <section className="room-list-panel">
        <header>
          <div>
            <strong>房间列表</strong>
            <span>{rooms.length} 个可用房间</span>
          </div>
        </header>

        <div className="room-table">
          {rooms.map((room) => (
            <article key={room.roomId} className="room-row">
              <div className="room-main">
                <strong>{room.name}</strong>
                <span><Hash size={14} aria-hidden />{room.roomId}</span>
              </div>
              <div className="room-badges">
                <span><ShieldCheck size={14} aria-hidden />{permissionLabel(room.permissionMode)}</span>
                <span>{room.passwordProtected ? <Lock size={14} aria-hidden /> : <KeyRound size={14} aria-hidden />}{room.passwordProtected ? '有密码' : '无密码'}</span>
                <span><Headphones size={14} aria-hidden />{room.voiceEnabled ? '语音开启' : '语音关闭'}</span>
                <span><Users size={14} aria-hidden />{room.accessMode}</span>
              </div>
              <time>更新 {formatTime(room.updatedAt)}</time>
              <div className="row-actions">
                <button type="button" title="进入房间" onClick={() => navigate(`/room/${room.roomId}`)}>
                  <DoorOpen size={16} aria-hidden />
                </button>
                <button type="button" title="编辑设置" onClick={() => beginEdit(room)}>
                  <Pencil size={16} aria-hidden />
                </button>
                <button type="button" title="归档房间" onClick={() => void handleArchive(room.roomId)}>
                  <Archive size={16} aria-hidden />
                </button>
              </div>
            </article>
          ))}
          {rooms.length === 0 && (
            <div className="empty-rooms">
              <DoorOpen size={22} aria-hidden />
              <span>还没有房间，先创建一个用于会议或头脑风暴的空间。</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
