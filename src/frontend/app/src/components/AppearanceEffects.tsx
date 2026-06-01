import { useEffect } from 'react';
import { useAppearanceStore } from '../store/appearanceStore';
import type { ThemeMode } from '../store/appearanceStore';

function resolveThemeMode(themeMode: ThemeMode) {
  if (themeMode !== 'system') {
    return themeMode;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function AppearanceEffects() {
  const themeMode = useAppearanceStore((state) => state.themeMode);

  useEffect(() => {
    const body = document.body;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      body.dataset.themeChoice = themeMode;
      body.dataset.theme = resolveThemeMode(themeMode);
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
      delete body.dataset.theme;
      delete body.dataset.themeChoice;
    };
  }, [themeMode]);

  return null;
}
