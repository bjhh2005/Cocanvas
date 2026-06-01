import { useEffect } from 'react';
import { useAppearanceStore } from '../store/appearanceStore';

export function AppearanceEffects() {
  const themeMode = useAppearanceStore((state) => state.themeMode);
  const density = useAppearanceStore((state) => state.density);
  const presentationMode = useAppearanceStore((state) => state.presentationMode);

  useEffect(() => {
    const body = document.body;
    body.dataset.theme = themeMode;
    body.dataset.density = density;
    body.dataset.presentationMode = presentationMode ? 'true' : 'false';

    return () => {
      delete body.dataset.theme;
      delete body.dataset.density;
      delete body.dataset.presentationMode;
    };
  }, [density, presentationMode, themeMode]);

  return null;
}
