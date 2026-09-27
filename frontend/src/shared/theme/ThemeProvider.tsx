import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { loadTheme, resolveTheme, saveTheme, systemPrefersDark, type Theme } from './theme'

interface ThemeContextValue {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(theme, prefersDark)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  const setTheme = (next: Theme) => {
    saveTheme(next)
    setThemeState(next)
  }

  return <ThemeContext value={{ theme, resolved, setTheme }}>{children}</ThemeContext>
}

// oxlint-disable-next-line react/only-export-components -- hook lives beside its provider
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
