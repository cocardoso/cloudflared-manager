import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import de from './de.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import it from './it.json';
import ptBR from './pt-BR.json';

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'de', label: 'Deutsch' },
] as const;

/** Regional variants use their language's bundle (pt-PT → pt-BR, es-MX → es); anything else is English. */
export const normalizeLanguage = (l: string) => {
  const base = l.toLowerCase().split('-')[0]!;
  if (base === 'pt') return 'pt-BR';
  return ['es', 'fr', 'it', 'de'].includes(base) ? base : 'en';
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'pt-BR': { translation: ptBR },
      es: { translation: es },
      fr: { translation: fr },
      it: { translation: it },
      de: { translation: de },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'pt-BR', 'es', 'fr', 'it', 'de'],
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
