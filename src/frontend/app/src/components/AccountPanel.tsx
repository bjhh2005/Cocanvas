import { useState } from 'react';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { loginUser } from '../network/api';
import { useUserStore } from '../store/userStore';

type AccountPanelProps = {
  compact?: boolean;
  onAccountChange?: () => void;
};

export function AccountPanel({ compact = false, onAccountChange }: AccountPanelProps) {
  const username = useUserStore((state) => state.username);
  const authToken = useUserStore((state) => state.authToken);
  const displayName = useUserStore((state) => state.displayName);
  const color = useUserStore((state) => state.color);
  const setAccount = useUserStore((state) => state.setAccount);
  const clearAccount = useUserStore((state) => state.clearAccount);
  const [loginName, setLoginName] = useState(username);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signedIn = Boolean(authToken && username);

  const submit = async () => {
    if (!loginName.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const account = await loginUser(loginName, password, displayName, color);
      setAccount(account);
      setLoginName(account.username);
      setPassword('');
      onAccountChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    clearAccount();
    setPassword('');
    onAccountChange?.();
  };

  if (signedIn) {
    return (
      <div className={`account-card${compact ? ' compact' : ''}`}>
        <span className="account-badge" style={{ background: color }} />
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

  return (
    <form
      className={`account-login${compact ? ' compact' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="account-login__title">
        <span className="account-login__icon">
          <ShieldCheck size={15} aria-hidden />
        </span>
        <div>
          <strong>账号</strong>
          {!compact && <span>登录后可管理成员</span>}
        </div>
      </div>
      <div className="account-login__fields">
        <label className="account-field">
          <span>用户名</span>
          <input
            value={loginName}
            placeholder="alice"
            autoComplete="username"
            onChange={(event) => setLoginName(event.target.value)}
          />
        </label>
        <label className="account-field">
          <span>密码</span>
          <input
            value={password}
            type="password"
            placeholder="至少 4 位"
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      </div>
      <button type="submit" className="account-button primary" disabled={loading}>
        <LogIn size={15} aria-hidden />
        <span>{loading ? '登录中' : '登录/注册'}</span>
      </button>
      {error && <small className="account-error" role="alert">{error}</small>}
    </form>
  );
}
