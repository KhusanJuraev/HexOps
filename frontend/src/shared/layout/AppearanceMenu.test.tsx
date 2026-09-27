import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import { AppearanceMenu } from './AppearanceMenu'

function renderMenu() {
  render(
    <ThemeProvider>
      <AppearanceMenu />
    </ThemeProvider>,
  )
  return screen.getByRole('button', { name: 'Appearance / Language' })
}

describe('AppearanceMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    void i18n.changeLanguage('en')
  })

  it('uses one neutral sliders icon, whatever the theme', async () => {
    const trigger = renderMenu()
    const icon = () => trigger.querySelector('svg')
    expect(icon()).toHaveClass('lucide-sliders-horizontal')
    expect(icon()).toHaveAttribute('aria-hidden', 'true')
    expect(trigger.querySelector('.lucide-sun, .lucide-moon')).toBeNull()

    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
    expect(document.documentElement).toHaveClass('dark')
    expect(icon()).toHaveClass('lucide-sliders-horizontal') // unchanged in dark
  })

  it('keeps its label and opens from the keyboard with theme and language choices', async () => {
    const trigger = renderMenu()
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    for (const name of ['Light', 'Dark', 'System', 'English', 'Русский', 'Oʻzbekcha']) {
      expect(await screen.findByRole('menuitemradio', { name })).toBeInTheDocument()
    }
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
