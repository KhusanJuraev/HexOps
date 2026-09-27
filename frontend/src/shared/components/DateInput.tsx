import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/utils'
import { daysInMonth, formatDate, formatMonth, parseDateInput, todayIso, type DateInputError } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'

const pad = (n: number) => String(n).padStart(2, '0')
const COMPLETE = /^\S+[/.]\S+[/.]\d{4}$/
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** Move a calendar day by `days` (no time zones involved: plain calendar arithmetic). */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const ny = first.getUTCFullYear()
  const nm = first.getUTCMonth() + 1
  return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

/** 0 = Monday … 6 = Sunday. */
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7

interface Props {
  id: string
  /** ISO 'YYYY-MM-DD', or '' for none. */
  value: string
  /** Called with a valid ISO date, or '' when the field is cleared. Never with invalid text. */
  onChange: (value: string) => void
  /** Told whenever the typed text becomes invalid or valid again (for blocking a submit). */
  onErrorChange?: (error: DateInputError | null) => void
  /** An error from elsewhere (e.g. the server), already translated; shown if the text is valid. */
  error?: string | null
  /** Extra ids for aria-describedby (a hint under the field). */
  describedBy?: string
  className?: string
}

/**
 * The one date field of HexOps (D-89): typed as DD/MM/YYYY — day first, always — or
 * picked from a calendar. The native date input shows the browser's own format
 * (MM/DD/YYYY in many builds), so it is not used anywhere.
 */
export function DateInput({ id, value, onChange, onErrorChange, error, describedBy, className }: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState(formatDate(value))
  const [synced, setSynced] = useState(value)
  const [problem, setProblem] = useState<DateInputError | null>(null) // current text's problem
  const [shown, setShown] = useState(false) // shown after the user leaves the field
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // The value changed from outside (e.g. "Clear filters"): show it.
  if (value !== synced) {
    setSynced(value)
    setText(formatDate(value))
    setProblem(null)
  }

  const report = (next: DateInputError | null) => {
    setProblem(next)
    onErrorChange?.(next)
  }

  const type = (next: string) => {
    setText(next)
    const parsed = parseDateInput(next)
    if ('error' in parsed) {
      // Once the year is complete, say what is wrong straight away: waiting for blur would
      // make the message appear as the user clicks Save, moving the button from under the
      // pointer. A half-typed date is only judged when the user leaves the field.
      if (COMPLETE.test(next.trim())) setShown(true)
      return report(parsed.error)
    }
    report(null)
    setShown(false)
    const nextValue = 'iso' in parsed ? parsed.iso : ''
    setSynced(nextValue)
    if (nextValue !== value) onChange(nextValue)
  }

  const pick = (day: string) => {
    setOpen(false)
    type(formatDate(day))
    input.current?.focus()
  }

  const message = problem && shown ? t(`dates.errors.${problem}`) : (error ?? null)
  const errorId = `${id}-date-error`
  const described = [message ? errorId : null, describedBy].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex min-w-0 gap-1.5">
        <Input
          ref={input}
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder={t('dates.placeholder')}
          value={text}
          maxLength={10}
          aria-invalid={message ? true : undefined}
          aria-describedby={described}
          data-date-input
          onChange={(e) => type(e.target.value)}
          onBlur={() => setShown(true)}
          onKeyDown={(e) => e.key === 'Enter' && setShown(true)}
          className="min-w-0 tabular-nums"
        />
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label={t('dates.openCalendar')} className="shrink-0">
              <CalendarDays aria-hidden="true" />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              collisionPadding={8}
              aria-label={t('dates.calendar')}
              className="bg-popover text-popover-foreground z-50 w-[17.5rem] max-w-[calc(100vw-16px)] rounded-xl border p-3 shadow-md outline-none"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Calendar selected={'iso' in parseDateInput(text) ? value : ''} onPick={pick} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      {message && (
        <p id={errorId} className="text-danger text-sm">
          {message}
        </p>
      )}
    </div>
  )
}

function Calendar({ selected, onPick }: { selected: string; onPick: (day: string) => void }) {
  const { t } = useTranslation()
  const [focus, setFocus] = useState(selected || todayIso())
  const grid = useRef<HTMLDivElement>(null)
  const today = todayIso()
  const weekdays = t('dates.weekdays', { returnObjects: true }) as string[]

  // Keyboard focus follows the focused day (roving tabindex); on open it starts there.
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus()
  }, [focus])

  const [y, m] = focus.split('-').map(Number)
  const first = iso(y, m, 1)
  const cells: (string | null)[] = [...Array(weekday(first)).fill(null)]
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(iso(y, m, d))
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))

  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1),
      PageDown: () => addMonths(focus, 1),
      Home: () => addDays(focus, -weekday(focus)),
      End: () => addDays(focus, 6 - weekday(focus)),
    }
    if (moves[e.key]) {
      e.preventDefault()
      setFocus(moves[e.key]())
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t('dates.previousMonth')} onClick={() => setFocus(addMonths(focus, -1))}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p className="text-sm font-medium tabular-nums" aria-live="polite" data-calendar-month>
          {formatMonth(`${y}-${pad(m)}`)}
        </p>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t('dates.nextMonth')} onClick={() => setFocus(addMonths(focus, 1))}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <div ref={grid} role="grid" aria-label={formatMonth(`${y}-${pad(m)}`)} onKeyDown={onKey} className="grid gap-0.5">
        <div role="row" className="grid grid-cols-7">
          {weekdays.map((w) => (
            <span key={w} role="columnheader" className="text-muted-foreground py-1 text-center text-xs">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, i) => (
          <div role="row" key={i} className="grid grid-cols-7">
            {week.map((day, j) =>
              day ? (
                <span role="gridcell" key={day} aria-selected={day === selected}>
                  <button
                    type="button"
                    data-day={day}
                    tabIndex={day === focus ? 0 : -1}
                    aria-label={formatDate(day)}
                    aria-current={day === today ? 'date' : undefined}
                    onClick={() => onPick(day)}
                    className={cn(
                      'focus-visible:ring-ring/50 h-8 w-full rounded-md text-sm tabular-nums outline-none focus-visible:ring-[3px]',
                      'hover:bg-accent',
                      day === today && 'font-semibold underline underline-offset-4',
                      day === selected && 'bg-primary text-primary-foreground hover:bg-primary',
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                </span>
              ) : (
                <span role="gridcell" key={`e${i}${j}`} />
              ),
            )}
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => onPick(today)}>
        {t('dates.today')}
      </Button>
    </div>
  )
}
