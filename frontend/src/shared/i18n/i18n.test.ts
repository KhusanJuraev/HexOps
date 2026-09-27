import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { afterEach, describe, expect, it } from 'vitest'

import i18n, { i18nOptions, LANGUAGE_STORAGE_KEY, resources } from './index'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

/** A fresh instance with the app's config, as on a new page load. */
async function freshInstance() {
  const instance = i18next.createInstance()
  await instance.use(LanguageDetector).init(i18nOptions)
  return instance
}

describe('locales', () => {
  const en = keys(resources.en.translation).sort()

  it.each(['ru', 'uz'] as const)('%s has exactly the same keys as en', (lng) => {
    expect(keys(resources[lng].translation).sort()).toEqual(en)
  })

  it.each(['en', 'ru', 'uz'] as const)('%s has no empty strings', (lng) => {
    const flat = JSON.stringify(resources[lng].translation)
    expect(flat).not.toContain('""')
  })
})

describe('language persistence', () => {
  afterEach(async () => {
    localStorage.clear()
    await i18n.changeLanguage('en')
  })

  it('saves the chosen language and restores it on the next load', async () => {
    await i18n.changeLanguage('ru')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru')
    expect(document.documentElement.lang).toBe('ru')

    const reloaded = await freshInstance()
    expect(reloaded.resolvedLanguage).toBe('ru')
    expect(reloaded.t('nav.projects')).toBe('Проекты')
  })

  it.each(['uz', 'en'] as const)('restores %s', async (lng) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng)
    expect((await freshInstance()).resolvedLanguage).toBe(lng)
  })

  it('falls back to a supported language for garbage in storage', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, '<script>')
    expect(['en', 'ru', 'uz']).toContain((await freshInstance()).resolvedLanguage)
  })
})
