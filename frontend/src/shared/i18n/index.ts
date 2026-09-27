import i18n, { type InitOptions } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import ru from './locales/ru.json'
import uz from './locales/uz.json'

export const LANGUAGES = [
  { code: 'uz', label: 'Oʻzbekcha' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
] as const
export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const resources = {
  en: { translation: en },
  ru: { translation: ru },
  uz: { translation: uz },
} as const

export const LANGUAGE_STORAGE_KEY = 'hexops.lang'

export const i18nOptions = {
  resources,
  supportedLngs: LANGUAGES.map((l) => l.code),
  nonExplicitSupportedLngs: true,
  load: 'languageOnly',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes output.
  detection: {
    order: ['localStorage', 'navigator'],
    lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    caches: ['localStorage'],
  },
} satisfies InitOptions

void i18n.use(LanguageDetector).use(initReactI18next).init(i18nOptions)

const syncHtmlLang = (lng: string) => document.documentElement.setAttribute('lang', lng)
syncHtmlLang(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', syncHtmlLang)

export default i18n
