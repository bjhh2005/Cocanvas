import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createRoom, fetchHealth } from '../network/api'
import { getStoredIdentity, saveIdentity } from '../utils/identity'
import './Home.css'

export default function Home() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [creating, setCreating] = useState(false)
  const [joinId, setJoinId] = useState(searchParams.get('room') ?? '')
  const [displayName, setDisplayName] = useState(() => getStoredIdentity()?.displayName ?? '')
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchHealth()
      .then(d => setBackendOk(d.status === 'ok'))
      .catch(() => setBackendOk(false))
  }, [])

  async function handleCreate() {
    if (!displayName.trim()) { setError('请先输入你的名字'); return }
    setError(null)
    setCreating(true)
    saveIdentity(displayName)
    try {
      const { roomId } = await createRoom()
      navigate(`/room/${roomId}`)
    } catch (e) {
      setError((e as Error).message)
      setCreating(false)
    }
  }

  function handleJoin() {
    if (!displayName.trim()) { setError('请先输入你的名字'); return }
    const id = joinId.trim()
    if (!id) return
    saveIdentity(displayName)
    navigate(`/room/${id}`)
  }

  return (
    <div className="home-page">
      <div className="home-bg" aria-hidden />

      <div className="home-card">
        <div className="home-brand">
          <h1>Cocanvas</h1>
          <p className="home-sub">Distributed Real-time Whiteboard</p>
        </div>

        <div className="home-name">
          <label className="home-name-label" htmlFor="display-name">你的名字</label>
          <input
            id="display-name"
            className="home-input home-name-input"
            placeholder="输入显示名称"
            value={displayName}
            maxLength={20}
            autoFocus
            onChange={e => setDisplayName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (joinId.trim() ? handleJoin() : handleCreate())}
          />
        </div>

        <button
          className="home-cta"
          onClick={handleCreate}
          disabled={creating || backendOk === false || !displayName.trim()}
        >
          {creating ? 'Creating…' : '创建新房间'}
        </button>

        <div className="home-divider"><span>或</span></div>

        <div className="home-join">
          <input
            className="home-input"
            placeholder="输入房间 ID"
            value={joinId}
            onChange={e => setJoinId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
          <button
            className="home-join-btn"
            onClick={handleJoin}
            disabled={!joinId.trim() || !displayName.trim()}
          >
            加入
          </button>
        </div>

        {error && <p className="home-error">⚠️ {error}</p>}

        <p className="home-health">
          后端：
          {backendOk === null
            ? <span className="dot dot-amber" />
            : backendOk
              ? <span className="dot dot-green" />
              : <span className="dot dot-red" />}
          <code>{backendOk === null ? 'checking…' : backendOk ? '可达' : '不可达'}</code>
        </p>
      </div>
    </div>
  )
}
