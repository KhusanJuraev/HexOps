import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Inbox } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Badge } from './Badge'
import { EmptyState } from './EmptyState'
import { useToast } from './toast'
import { ToastProvider } from './ToastProvider'

function ToastButtons() {
  const toast = useToast()
  return (
    <>
      <button onClick={() => toast({ message: 'Saved' })}>info</button>
      <button onClick={() => toast({ message: 'Failed', tone: 'error' })}>error</button>
    </>
  )
}

describe('EmptyState', () => {
  it('renders a heading, description and action', () => {
    render(<EmptyState icon={Inbox} title="No projects" description="Create one" action={<button>New</button>} />)
    expect(screen.getByRole('heading', { level: 2, name: 'No projects' })).toBeInTheDocument()
    expect(screen.getByText('Create one')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
  })
})

describe('Badge', () => {
  it('always carries text, with the dot hidden from assistive tech', () => {
    const { container } = render(<Badge tone="success" dot>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('toasts', () => {
  afterEach(() => vi.useRealTimers())

  it('announces info politely and errors assertively, and can be dismissed', async () => {
    render(
      <ToastProvider>
        <ToastButtons />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'info' }))
    await userEvent.click(screen.getByRole('button', { name: 'error' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')

    const [first] = screen.getAllByRole('button', { name: 'Dismiss' })
    await userEvent.click(first)
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('dismisses itself after a few seconds and keeps at most three', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastButtons />
      </ToastProvider>,
    )
    const info = screen.getByRole('button', { name: 'info' })
    act(() => {
      for (let i = 0; i < 5; i++) info.click()
    })
    expect(screen.getAllByText('Saved')).toHaveLength(3)
    act(() => vi.advanceTimersByTime(5100))
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })
})
