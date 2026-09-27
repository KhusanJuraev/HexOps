export type Theme = 'light' | 'dark' | 'system'
export const THEMES: Theme[] = ['light', 'dark', 'system']
const STORAGE_KEY = 'hexops.theme'

export function loadTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  return 'system'
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Non-fatal: the choice just won't persist.
  }
}

export function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function resolveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return theme
}
