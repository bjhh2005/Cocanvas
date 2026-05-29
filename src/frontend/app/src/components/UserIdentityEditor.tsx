import { useState, type KeyboardEvent } from 'react';
import { UserRound } from 'lucide-react';
import { useUserStore, userPalette } from '../store/userStore';

type UserIdentityEditorProps = {
  compact?: boolean;
};

export function UserIdentityEditor({ compact = false }: UserIdentityEditorProps) {
  const displayName = useUserStore((state) => state.displayName);
  const color = useUserStore((state) => state.color);
  const setDisplayName = useUserStore((state) => state.setDisplayName);
  const setColor = useUserStore((state) => state.setColor);
  return (
    <UserIdentityEditorInner
      key={displayName}
      compact={compact}
      displayName={displayName}
      color={color}
      setDisplayName={setDisplayName}
      setColor={setColor}
    />
  );
}

type UserIdentityEditorInnerProps = {
  compact: boolean;
  displayName: string;
  color: string;
  setDisplayName: (displayName: string) => void;
  setColor: (color: string) => void;
};

function UserIdentityEditorInner({
  compact,
  displayName,
  color,
  setDisplayName,
  setColor,
}: UserIdentityEditorInnerProps) {
  const [draftName, setDraftName] = useState(displayName);
  const [isComposing, setIsComposing] = useState(false);

  const commitName = () => {
    const nextName = draftName.trim();
    if (nextName && nextName !== displayName) {
      setDisplayName(nextName);
    } else {
      setDraftName(displayName);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || isComposing) {
      return;
    }

    event.currentTarget.blur();
  };

  return (
    <section className={compact ? 'identity-card compact' : 'identity-card'} aria-label="我的协作身份">
      <UserRound size={compact ? 15 : 17} aria-hidden />
      <input
        value={draftName}
        aria-label="协作显示名称"
        onChange={(event) => setDraftName(event.target.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(event) => {
          setIsComposing(false);
          setDraftName(event.currentTarget.value);
        }}
        onBlur={commitName}
        onKeyDown={handleKeyDown}
      />
      <div className={compact ? 'color-swatches compact' : 'color-swatches'} aria-label="选择协作颜色">
        {userPalette.map((item) => (
          <button
            key={item}
            type="button"
            className={item === color ? 'active' : ''}
            title={item}
            style={{ background: item }}
            onClick={() => setColor(item)}
          />
        ))}
        <label className="custom-color" title="自定义颜色">
          <input
            type="color"
            value={color}
            aria-label="自定义协作颜色"
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
      </div>
    </section>
  );
}
