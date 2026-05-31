import { useState } from 'react';
import { LogIn, LogOut, Lock, User, UserPlus } from 'lucide-react';
import { loginUser, registerUser } from '../network/api';
import { useUserStore } from '../store/userStore';

type AccountPanelProps = {
  compact?: boolean;
  // 'inline' = 嵌在头部的小表单；'gate' = 进入前的全屏登录卡
  variant?: 'inline' | 'gate';
  onAccountChange?: () => void;
};

export function AccountPanel({ compact = false, variant = 'inline', onAccountChange }: AccountPanelProps) {
  const username = useUserStore((state) => state.username);
  const authToken = useUserStore((state) => state.authToken);
  const displayName = useUserStore((state) => state.displayName);
  const color = useUserStore((state) => state.color);
  const setAccount = useUserStore((state) => state.setAccount);
  const clearAccount = useUserStore((state) => state.clearAccount);
  const [loginName, setLoginName] = useState(username);
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(displayName);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signedIn = Boolean(authToken && username);

  const submit = async () => {
    if (!loginName.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    if (password.length < 4) {
      setError('密码至少 4 位');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const account = mode === 'login'
        ? await loginUser(loginName, password, displayName, color)
        : await registerUser(loginName, password, nickname.trim() || loginName, color);
      setAccount(account);
      setLoginName(account.username);
      setPassword('');
      onAccountChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'login' ? '登录失败' : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    clearAccount();
    setPassword('');
    onAccountChange?.();
  };

  // ── 已登录：紧凑账号卡 ──
  if (signedIn) {
    return (
      <div className={`account-card${compact ? ' compact' : ''}`}>
        <span className="account-badge" style={{ background: color }}>
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="account-card__meta">
          {!compact && <span className="account-eyebrow">已登录</span>}
          <strong>{displayName}</strong>
          <span>@{username}</span>
        </div>
        <button type="button" className="account-button secondary" onClick={logout} title="退出账号">
          <LogOut size={15} aria-hidden />
          {!compact && <span>退出</span>}
        </button>
      </div>
    );
  }

  // ── 共享的表单主体 ──
  const formBody = (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="auth-tabs" role="tablist" aria-label="账号操作">
        <button
          type="button"
          role="tab"
          className={mode === 'login' ? 'active' : ''}
          aria-selected={mode === 'login'}
          onClick={() => { setMode('login'); setError(null); }}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          className={mode === 'register' ? 'active' : ''}
          aria-selected={mode === 'register'}
          onClick={() => { setMode('register'); setError(null); }}
        >
          注册
        </button>
        <span className={`auth-tabs__slider auth-tabs__slider--${mode}`} aria-hidden />
      </div>

      <label className="auth-field">
        <User size={16} aria-hidden />
        <input
          value={loginName}
          placeholder="用户名"
          autoComplete="username"
          onChange={(event) => setLoginName(event.target.value)}
        />
      </label>

      {mode === 'register' && (
        <label className="auth-field">
          <UserPlus size={16} aria-hidden />
          <input
            value={nickname}
            placeholder="昵称（显示名，可留空）"
            onChange={(event) => setNickname(event.target.value)}
          />
        </label>
      )}

      <label className="auth-field">
        <Lock size={16} aria-hidden />
        <input
          value={password}
          type="password"
          placeholder="密码（至少 4 位）"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      <button type="submit" className="auth-submit" disabled={loading}>
        {mode === 'login' ? <LogIn size={16} aria-hidden /> : <UserPlus size={16} aria-hidden />}
        <span>{loading ? (mode === 'login' ? '登录中…' : '注册中…') : (mode === 'login' ? '登录' : '注册并登录')}</span>
      </button>

      {error && <small className="auth-error" role="alert">{error}</small>}
    </form>
  );

  // ── 全屏登录门 ──
  if (variant === 'gate') {
    return (
      <div className="auth-gate">
        <div className="auth-gate__card">
          <div className="auth-gate__brand">
            <span className="auth-gate__logo">C</span>
            <h1>Cocanvas</h1>
            <p>多人实时协作白板 · 登录后进入工作台</p>
          </div>
          {formBody}
          <p className="auth-gate__hint">进入房间前需要登录，登录后即可创建、加入与协作。</p>
        </div>
      </div>
    );
  }

  // ── 内联表单（头部） ──
  return <div className={`account-login${compact ? ' compact' : ''}`}>{formBody}</div>;
}
