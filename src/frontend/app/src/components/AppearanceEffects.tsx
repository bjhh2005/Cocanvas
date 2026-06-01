import { useEffect } from 'react';
import { useAppearanceStore } from '../store/appearanceStore';

export function AppearanceEffects() {
  const themeMode = useAppearanceStore((state) => state.themeMode);

  useEffect(() => {
    const body = document.body;
    body.dataset.theme = themeMode;

    return () => {
      delete body.dataset.theme;
    };
  }, [themeMode]);

  return null;
}
