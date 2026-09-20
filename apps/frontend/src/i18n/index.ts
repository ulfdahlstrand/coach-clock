import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import sv from './locales/sv.json';

/**
 * Svenska är appens språk, inte en översättning av engelska: `sv` är både
 * startspråk och fallback, och sv.json är den enda källan till nyckelnamnen.
 * Fler språk läggs till som ytterligare resurser — sv rörs inte då.
 */
export const defaultNS = 'translation';
export const resources = { sv: { translation: sv } } as const;

// Ingen top-level await: resurserna är inbyggda, så init är klar direkt och
// esbuild slipper ett mål som inte stöder top-level await.
void i18n.use(initReactI18next).init({
  resources,
  lng: 'sv',
  fallbackLng: 'sv',
  defaultNS,
  interpolation: {
    // React escapar redan allt som renderas.
    escapeValue: false,
  },
});

export default i18n;
