import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark' | 'contrast';
export type CanvasBackgroundMode = 'grid' | 'dots' | 'paper' | 'blueprint' | 'plain';

type AppearanceState = {
  themeMode: ThemeMode;
  canvasBackground: CanvasBackgroundMode;
  showGridLabels: boolean;
  setThemeMode: (themeMode: ThemeMode) => void;
  setCanvasBackground: (canvasBackground: CanvasBackgroundMode) => void;
  setShowGridLabels: (showGridLabels: boolean) => void;
};

const storageKey = 'cocanvas:appearance';

const defaultState = {
  themeMode: 'system' as ThemeMode,
  canvasBackground: 'grid' as CanvasBackgroundMode,
  showGridLabels: false,
};

const readStoredState = () => {
  if (typeof window === 'undefined') {
    return defaultState;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return defaultState;
    }
    const parsed = JSON.parse(raw) as Partial<typeof defaultState>;
    return {
      ...defaultState,
      ...parsed,
    };
  } catch {
    return defaultState;
  }
};

const writeStoredState = (state: Pick<AppearanceState, keyof typeof defaultState>) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(state));
};

export const useAppearanceStore = create<AppearanceState>((set) => ({
  ...readStoredState(),
  setThemeMode: (themeMode) => set((state) => {
    const next = { ...state, themeMode };
    writeStoredState(next);
    return { themeMode };
  }),
  setCanvasBackground: (canvasBackground) => set((state) => {
    const next = { ...state, canvasBackground };
    writeStoredState(next);
    return { canvasBackground };
  }),
  setShowGridLabels: (showGridLabels) => set((state) => {
    const next = { ...state, showGridLabels };
    writeStoredState(next);
    return { showGridLabels };
  }),
}));

export const appearanceSnapshot = () => {
  const state = useAppearanceStore.getState();
  return {
    themeMode: state.themeMode,
    canvasBackground: state.canvasBackground,
    showGridLabels: state.showGridLabels,
  };
};
