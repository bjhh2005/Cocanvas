import { Monitor, Moon, Palette, Rows3, Sun } from 'lucide-react';
import {
  type CanvasBackgroundMode,
  type ThemeMode,
  useAppearanceStore,
} from '../store/appearanceStore';

type AppearancePanelProps = {
  onClose: () => void;
  scope?: 'theme' | 'canvas' | 'all';
};

const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Monitor }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'contrast', label: 'Contrast', icon: Palette },
];

const backgroundOptions: Array<{ value: CanvasBackgroundMode; label: string }> = [
  { value: 'grid', label: 'Grid' },
  { value: 'dots', label: 'Dots' },
  { value: 'paper', label: 'Paper' },
  { value: 'blueprint', label: 'Blueprint' },
  { value: 'plain', label: 'Plain' },
];

export function AppearancePanel({ onClose, scope = 'all' }: AppearancePanelProps) {
  const themeMode = useAppearanceStore((state) => state.themeMode);
  const canvasBackground = useAppearanceStore((state) => state.canvasBackground);
  const showGridLabels = useAppearanceStore((state) => state.showGridLabels);
  const setThemeMode = useAppearanceStore((state) => state.setThemeMode);
  const setCanvasBackground = useAppearanceStore((state) => state.setCanvasBackground);
  const setShowGridLabels = useAppearanceStore((state) => state.setShowGridLabels);
  const showTheme = scope === 'theme' || scope === 'all';
  const showCanvas = scope === 'canvas' || scope === 'all';
  const title = scope === 'canvas' ? 'Canvas' : 'Appearance';

  return (
    <div className="panel-overlay" role="dialog" aria-modal="true" aria-label={`${title} settings`} onClick={onClose}>
      <section className="appearance-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <Palette size={18} aria-hidden />
            <strong>{title}</strong>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>

        {showTheme && (
          <div className="appearance-section">
            <span>Theme</span>
            <div className="segmented-control">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={themeMode === value ? 'active' : undefined}
                  onClick={() => setThemeMode(value)}
                >
                  <Icon size={15} aria-hidden />
                  <small>{label}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {showCanvas && (
          <div className="appearance-section">
            <span>Canvas style</span>
            <div className="segmented-control wrap">
              {backgroundOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={canvasBackground === option.value ? 'active' : undefined}
                  onClick={() => setCanvasBackground(option.value)}
                >
                  <Rows3 size={15} aria-hidden />
                  <small>{option.label}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {showCanvas && (
          <label className="appearance-toggle">
            <input
              type="checkbox"
              checked={showGridLabels}
              onChange={(event) => setShowGridLabels(event.target.checked)}
            />
            <span>Grid labels</span>
          </label>
        )}
      </section>
    </div>
  );
}
