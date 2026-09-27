import { describe, expect, it } from 'vitest'

import { loadTheme, resolveTheme, saveTheme } from './theme'

describe('theme', () => {
  it('resolves system against the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('persists a valid choice and ignores garbage', () => {
    saveTheme('dark')
    expect(loadTheme()).toBe('dark')
    localStorage.setItem('hexops.theme', '<script>')
    expect(loadTheme()).toBe('system')
  })
})
