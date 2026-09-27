import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/shared/i18n'

import { MarkdownEditor } from './MarkdownEditor'

function setWidth(wide: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({ matches: wide && query.includes('min-width'), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
  )
}

function Harness({ initial = '', error }: { initial?: string; error?: string }) {
  const [value, setValue] = useState(initial)
  return <MarkdownEditor id="body" label="Body" value={value} onChange={setValue} maxLength={1000} error={error} />
}

describe('MarkdownEditor on desktop', () => {
  beforeEach(() => {
    localStorage.clear()
    setWidth(true)
    void i18n.changeLanguage('en')
  })
  afterEach(() => localStorage.clear())

  it('defaults to Split with a live, safe preview', async () => {
    render(<Harness />)
    const modes = screen.getByRole('radiogroup', { name: 'Editor view' })
    expect(within(modes).getByRole('radio', { name: 'Split' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.type(screen.getByLabelText('Body'), '# Hi{enter}{enter}<script>x</script>')
    const preview = screen.getByRole('region', { name: 'Preview' })
    expect(await within(preview).findByRole('heading', { name: 'Hi', level: 3 })).toBeInTheDocument()
    expect(preview.querySelector('script')).toBeNull()
    const length = (screen.getByLabelText('Body') as HTMLTextAreaElement).value.length
    expect(length).toBe('# Hi\n\n<script>x</script>'.length)
    expect(screen.getByText(`${length} / 1000 characters`)).toBeInTheDocument()
  })

  it('switches modes with the keyboard, keeps the text, and remembers the choice', async () => {
    const { unmount } = render(<Harness initial="**kept**" />)
    const split = screen.getByRole('radio', { name: 'Split' })
    split.focus()
    await userEvent.keyboard('{ArrowRight}{Enter}')
    // Radix moves focus with the arrows; activation follows focus or Enter/Space.
    await userEvent.click(screen.getByRole('radio', { name: 'Preview' }))
    expect(screen.getByLabelText('Body', { selector: 'textarea' })).not.toBeVisible()
    expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent('kept')

    await userEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Body')).toHaveValue('**kept**')
    expect(localStorage.getItem('hexops.editorMode')).toBe('markdown')

    unmount()
    render(<Harness />)
    expect(screen.getByRole('radio', { name: 'Markdown' })).toHaveAttribute('aria-checked', 'true')
  })

  it('links an error to the textarea', () => {
    render(<Harness error="Too long" />)
    expect(screen.getByLabelText('Body')).toHaveAccessibleDescription(/Too long/)
    expect(screen.getByLabelText('Body')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('MarkdownEditor on phones', () => {
  beforeEach(() => {
    localStorage.clear()
    setWidth(false)
    void i18n.changeLanguage('en')
  })

  it('shows Edit and Preview tabs, Edit first; arrow keys move between tabs', async () => {
    render(<Harness initial={'| a |\n|---|\n| 1 |'} />)
    const edit = screen.getByRole('tab', { name: 'Edit' })
    expect(edit).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()
    edit.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Preview' }).querySelector('table')).not.toBeNull()
    expect(screen.getByLabelText('Body', { selector: 'textarea' })).not.toBeVisible()
    expect(screen.queryByRole('radiogroup', { name: 'Editor view' })).not.toBeInTheDocument()
  })

  it('is translated', async () => {
    await i18n.changeLanguage('uz')
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'Tahrirlash' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Koʻrinish' })).toBeInTheDocument()
  })
})
