// 用户身份：每个标签独立（sessionStorage），刷新保留，关闭清空
// 这样一台机器开多窗口能模拟多用户协同测试

const STORAGE_KEY = 'cocanvas.identity.v1'

const NAME_POOL = ['Fox', 'Otter', 'Heron', 'Lynx', 'Wren', 'Sable', 'Crane', 'Vixen', 'Quill', 'Ember']
const COLOR_POOL = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e']

export interface Identity {
  userId: string
  displayName: string
  color: string
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function getStoredIdentity(): Identity | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as Identity } catch { return null }
}

export function hasIdentity(): boolean {
  return getStoredIdentity() !== null
}

// Save (or update) identity with the given displayName. Preserves userId & color if already set.
export function saveIdentity(displayName: string): Identity {
  const existing = getStoredIdentity()
  const name = displayName.trim() || (pick(NAME_POOL) + '-' + Math.floor(Math.random() * 1000))
  const identity: Identity = {
    userId: existing?.userId ?? ('u-' + crypto.randomUUID().slice(0, 8)),
    displayName: name,
    color: existing?.color ?? pick(COLOR_POOL),
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  return identity
}

// Returns existing identity, or generates + saves a random one (backward-compat for Room.tsx).
export function getIdentity(): Identity {
  const existing = getStoredIdentity()
  if (existing) return existing
  return saveIdentity('')
}
