import { useCallback, useState } from 'react'

/** The desktop sidebar choice (≥ 1024 px only; tablet rail and phone drawer ignore it). */
const STORAGE_KEY = 'hexops.sidebar'

export function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed'
  } catch {
    return false // storage unavailable (private mode, blocked site data)
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded')
  } catch {
    // Non-fatal: the choice just won't persist.
  }
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const toggle = useCallback(
    () =>
      setCollapsed((was) => {
        saveCollapsed(!was)
        return !was
      }),
    [],
  )
  return [collapsed, toggle]
}
