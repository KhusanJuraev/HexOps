import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/shared/i18n'

import { DateInput } from './DateInput'

function Harness({ initial = '', onChange = () => {} }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <label htmlFor="d">Day</label>
      <DateInput
        id="d"
        value={value}
        onChange={(v) => {
          setValue(v)
          onChange(v)
        }}
      />
      <output data-testid="value">{value}</output>
      <button type="button" onClick={() => setValue('2024-02-29')}>
        set from outside
      </button>
    </>
  )
}

describe('DateInput', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('shows a stored ISO date as DD/MM/YYYY and hands ISO back', async () => {
    const onChange = vi.fn()
    render(<Harness initial="2026-06-05" onChange={onChange} />)
    const field = screen.getByLabelText('Day')
    expect(field).toHaveValue('05/06/2026')
    expect(field).toHaveAttribute('placeholder', 'DD/MM/YYYY')
    await userEvent.clear(field)
    expect(onChange).toHaveBeenLastCalledWith('') // cleared = no date
    await userEvent.type(field, '05/06/2027')
    expect(onChange).toHaveBeenLastCalledWith('2027-06-05') // 5 June, never 6 May
    expect(screen.getByTestId('value')).toHaveTextContent('2027-06-05')
  })

  it('explains an impossible or ambiguous date after leaving the field, in the UI language', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const field = screen.getByLabelText('Day')
    await userEvent.type(field, '29/02/202')
    expect(screen.queryByText(/does not exist|Enter the date/)).not.toBeInTheDocument() // half-typed: not judged yet
    await userEvent.type(field, '6')
    // A complete but impossible date is flagged at once (not only on blur, which would
    // move a Save button from under the pointer).
    expect(screen.getByText('This date does not exist (check the day and month).')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('This date does not exist (check the day and month).')
    expect(onChange).not.toHaveBeenCalled()

    await i18n.changeLanguage('ru')
    await userEvent.clear(field)
    await userEvent.type(field, '5/6/26{Enter}')
    expect(screen.getByText(/Введите дату в формате DD\/MM\/YYYY, сначала день/)).toBeInTheDocument()
    await userEvent.clear(field)
    await userEvent.type(field, '29/02/2028')
    expect(screen.queryByText(/Такой даты|Введите дату/)).not.toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith('2028-02-29') // a leap day
  })

  it('judges a half-typed date when the user leaves the field', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByLabelText('Day'), '05/06')
    expect(screen.queryByText(/Enter the date as DD\/MM\/YYYY/)).not.toBeInTheDocument()
    await userEvent.tab()
    expect(screen.getByText('Enter the date as DD/MM/YYYY, day first: 05/06/2026 is 5 June 2026.')).toBeInTheDocument()
  })

  it('follows a value changed from outside', async () => {
    render(<Harness initial="2026-01-01" />)
    await userEvent.click(screen.getByRole('button', { name: 'set from outside' }))
    expect(screen.getByLabelText('Day')).toHaveValue('29/02/2024')
  })

  it('picks a day from the calendar with the keyboard', async () => {
    const onChange = vi.fn()
    render(<Harness initial="2026-01-31" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose a date from the calendar' }))
    // Opens on the chosen day, week starting on Monday, month shown as MM/YYYY.
    expect(await screen.findByRole('button', { name: '31/01/2026' })).toHaveFocus()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])
    expect(screen.getByRole('grid', { name: '01/2026' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}') // across the month end
    expect(screen.getByRole('button', { name: '01/02/2026' })).toHaveFocus()
    expect(screen.getByRole('grid', { name: '02/2026' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{PageDown}') // +7 days, then +1 month
    expect(screen.getByRole('button', { name: '08/03/2026' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('2026-03-08')
    expect(screen.getByLabelText('Day')).toHaveValue('08/03/2026')
    expect(screen.getByLabelText('Day')).toHaveFocus()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('closes the calendar with Escape and keeps the value', async () => {
    render(<Harness initial="2028-02-29" />)
    await userEvent.click(screen.getByRole('button', { name: 'Choose a date from the calendar' }))
    expect(await screen.findByRole('button', { name: '29/02/2028' })).toHaveFocus()
    expect(screen.getByRole('button', { name: '29/02/2028' }).closest('[role=gridcell]')).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Day')).toHaveValue('29/02/2028')
  })
})
