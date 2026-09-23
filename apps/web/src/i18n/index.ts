import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ptBR from './pt-BR.json';

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
] as const;

/** Any Portuguese variant (pt, pt-PT) uses the pt-BR bundle. */
export const normalizeLanguage = (l: string) => (l.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en');

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'pt-BR'],
    load: 'currentOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'tm.lang',
      caches: ['localStorage'],
      convertDetectedLanguage: (l: string) => normalizeLanguage(l),
    },
    interpolation: { escapeValue: false },
  });

export const setLanguage = (l: string) => i18n.changeLanguage(normalizeLanguage(l));

export default i18n;
