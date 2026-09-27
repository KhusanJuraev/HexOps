import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/shared/i18n'

import {
  daysInMonth,
  formatCompact,
  formatDate,
  formatDateTime,
  formatMonth,
  localDateTimeToIso,
  parseDateInput,
  parseTimeInput,
  todayIso,
} from './format'

// Node applies a changed TZ to later Date calls, so one run covers several zones.
const zone = (tz: string) => vi.stubEnv('TZ', tz)

describe('date display: DD/MM/YYYY and 24-hour HH:mm everywhere (D-89)', () => {
  afterEach(async () => {
    vi.unstubAllEnvs()
    await i18n.changeLanguage('en')
  })

  it('is the same in every UI language, never the browser locale', async () => {
    for (const lng of ['en', 'ru', 'uz']) {
      await i18n.changeLanguage(lng)
      expect(formatDate('2026-06-05')).toBe('05/06/2026')
      expect(formatMonth('2026-02')).toBe('02/2026')
      expect(formatDateTime(new Date(2026, 8, 26, 19, 5).toISOString())).toBe('26/09/2026 19:05')
    }
  })

  it('never moves a calendar date, in any time zone', () => {
    for (const tz of ['Pacific/Honolulu', 'UTC', 'Asia/Tashkent', 'Pacific/Kiritimati']) {
      zone(tz)
      expect(formatDate('2026-03-01')).toBe('01/03/2026')
      expect(formatDate('2025-12-31')).toBe('31/12/2025')
      expect(formatDate('2028-02-29')).toBe('29/02/2028')
    }
  })

  it('shows a timestamp in the viewer’s time zone, around midnight and month ends', () => {
    const utc = '2026-01-31T23:30:00Z' // stored in UTC by the API
    zone('UTC')
    expect(formatDateTime(utc)).toBe('31/01/2026 23:30')
    zone('Asia/Tashkent') // UTC+5: already 1 February there
    expect(formatDateTime(utc)).toBe('01/02/2026 04:30')
    zone('Pacific/Honolulu') // UTC−10
    expect(formatDateTime(utc)).toBe('31/01/2026 13:30')
    expect(formatDateTime('2026-06-05T00:00:00Z')).toBe('04/06/2026 14:00')
  })

  it('keeps empty and broken values empty', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('05/06/2026')).toBe('')
    expect(formatDateTime('')).toBe('')
    expect(formatDateTime('not a date')).toBe('')
  })

  it('compacts axis numbers', () => {
    expect(formatCompact(123456790)).toBe('123.5M')
    expect(formatCompact(40)).toBe('40')
  })
})

describe('date entry: day first, real dates only', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads 05/06/2026 as 5 June, never 6 May', () => {
    expect(parseDateInput('05/06/2026')).toEqual({ iso: '2026-06-05' })
    expect(parseDateInput('5/6/2026')).toEqual({ iso: '2026-06-05' })
    expect(parseDateInput('05.06.2026')).toEqual({ iso: '2026-06-05' })
    expect(parseDateInput(' 31/12/2025 ')).toEqual({ iso: '2025-12-31' })
  })

  it('knows leap years', () => {
    expect(parseDateInput('29/02/2028')).toEqual({ iso: '2028-02-29' })
    expect(parseDateInput('29/02/2000')).toEqual({ iso: '2000-02-29' }) // divisible by 400
    expect(parseDateInput('29/02/2026')).toEqual({ error: 'date_invalid' })
    expect(parseDateInput('29/02/1900')).toEqual({ error: 'date_invalid' }) // divisible by 100
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 4)).toBe(30)
  })

  it.each([
    ['31/04/2026', 'date_invalid'],
    ['00/01/2026', 'date_invalid'],
    ['13/13/2026', 'date_invalid'],
    ['05/06/26', 'date_format'], // two-digit years are ambiguous
    ['2026-06-05', 'date_format'], // ISO is for the API, not for typing
    ['06/05', 'date_format'],
    ['05/06-2026', 'date_format'], // mixed separators
    ['5 June 2026', 'date_format'],
    ['aa/bb/cccc', 'date_format'],
  ])('refuses %s (%s)', (text, error) => {
    expect(parseDateInput(text)).toEqual({ error })
  })

  it('treats an empty field as no date', () => {
    expect(parseDateInput('   ')).toEqual({ empty: true })
  })

  it('reads 24-hour times only', () => {
    expect(parseTimeInput('09:30')).toEqual([9, 30])
    expect(parseTimeInput('9:05')).toEqual([9, 5])
    expect(parseTimeInput('23:59')).toEqual([23, 59])
    expect(parseTimeInput('24:00')).toEqual({ error: 'time_format' })
    expect(parseTimeInput('9pm')).toEqual({ error: 'time_format' })
    expect(parseTimeInput('')).toEqual({ empty: true })
  })

  it('turns a local date and time into the UTC instant the API stores', () => {
    zone('Asia/Tashkent') // UTC+5
    expect(localDateTimeToIso('2026-06-01', [2, 0])).toBe('2026-05-31T21:00:00.000Z')
    zone('UTC')
    expect(localDateTimeToIso('2026-06-01', [2, 0])).toBe('2026-06-01T02:00:00.000Z')
  })

  it('knows today in the viewer’s time zone', () => {
    zone('Asia/Tashkent')
    expect(todayIso(new Date('2026-01-31T20:00:00Z'))).toBe('2026-02-01')
    zone('UTC')
    expect(todayIso(new Date('2026-01-31T20:00:00Z'))).toBe('2026-01-31')
  })
})
