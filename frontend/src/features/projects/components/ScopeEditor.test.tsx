import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/shared/i18n'

import { ScopeEditor, type ScopeRow } from './ScopeEditor'

let latest: ScopeRow[] = []

function Harness({ initial }: { initial: ScopeRow[] }) {
  const [rows, setRows] = useState(initial)
  const next = useRef(initial.length)
  const change = (r: ScopeRow[]) => {
    latest = r // recorded in the event handler, not during render
    setRows(r)
  }
  return <ScopeEditor rows={rows} onChange={change} errors={{ 1: 'Bad value' }} newKey={() => next.current++} />
}

const rows = (...values: string[]): ScopeRow[] => {
  latest = values.map((value, key) => ({ key, kind: 'domain', value, note: '' }))
  return latest
}
const values = () => latest.map((r) => r.value)
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe('ScopeEditor', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('adds a row and focuses its value field', async () => {
    render(<Harness initial={[]} />)
    expect(screen.getByText('No assets yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add asset' }))
    await frame()
    expect(screen.getByRole('group', { name: 'Asset 1' })).toBeInTheDocument()
    expect(screen.getAllByLabelText('Value')[0]).toHaveFocus()
    await userEvent.keyboard('a.example.com')
    expect(latest[0]).toMatchObject({ kind: 'domain', value: 'a.example.com', note: '' })
  })

  it('moves rows with the arrows and keeps focus on the moved row', async () => {
    render(<Harness initial={rows('one.example', 'two.example', 'three.example')} />)
    expect(screen.getByRole('button', { name: 'Move asset 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move asset 3 down' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Move asset 3 up' }))
    await frame()
    expect(values()).toEqual(['one.example', 'three.example', 'two.example'])
    expect(screen.getByRole('button', { name: 'Move asset 2 up' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await frame()
    expect(values()).toEqual(['three.example', 'one.example', 'two.example'])
  })

  it('removes a row and moves focus to a neighbour', async () => {
    render(<Harness initial={rows('one.example', 'two.example')} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove asset 1' }))
    await frame()
    expect(values()).toEqual(['two.example'])
    expect(screen.getByLabelText('Value')).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Remove asset 1' }))
    await frame()
    expect(screen.getByRole('button', { name: 'Add asset' })).toHaveFocus()
  })

  it('links a row error to its value field and never alters typed text', async () => {
    render(<Harness initial={rows('ok.example', '')} />)
    const second = screen.getAllByLabelText('Value')[1]
    expect(second).toHaveAccessibleDescription('Bad value')
    await userEvent.type(second, '  *.Mixed.Example  ')
    expect(latest[1].value).toBe('  *.Mixed.Example  ')
  })

  it('offers every scope kind, translated', async () => {
    await i18n.changeLanguage('ru')
    render(<Harness initial={rows('x')} />)
    const options = [...screen.getByLabelText('Вид').querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(['Домен', 'Маска домена', 'URL', 'IP-адрес', 'Диапазон IP (CIDR)', 'Другое'])
  })
})
