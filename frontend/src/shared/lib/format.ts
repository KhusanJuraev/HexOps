import i18n from 'i18next'

/**
 * The one place HexOps turns dates into text and text into dates (D-89).
 *
 * Every visible date is DD/MM/YYYY and every visible time is 24-hour HH:mm, in all
 * three languages; nothing depends on the browser's locale. The API is unchanged:
 * calendar dates travel as ISO "YYYY-MM-DD", timestamps as ISO in UTC.
 *
 * - A calendar date ("2026-06-05") is converted as text, never through Date, so it
 *   can never move by a day in any time zone.
 * - A timestamp is shown in the viewer's own time zone (what they lived through).
 * - A month bucket ("2026-06", UTC months on the server) is shown as MM/YYYY.
 */

const locale = () => i18n.resolvedLanguage ?? 'en'
const pad = (n: number) => String(n).padStart(2, '0')
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** '2026-06-05' → '05/06/2026'. */
export function formatDate(dateOnly: string | null | undefined): string {
  const m = dateOnly ? ISO_DAY.exec(dateOnly) : null
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** ISO timestamp → 'DD/MM/YYYY HH:mm' in the viewer's time zone (24-hour clock). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** '2026-06' (a UTC calendar month) → '06/2026'. */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-')
  return y && m ? `${m}/${y}` : month
}

/** 1234567 → "1.2M" (axis ticks), in the UI language. */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// --- input -------------------------------------------------------------------------

export type DateInputError = 'date_format' | 'date_invalid'

/** Days in a month, leap years included (Gregorian). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Text typed by the user → ISO 'YYYY-MM-DD'. Day first, always: '05/06/2026' is
 * 5 June 2026. Accepts '/' or '.' between parts, one- or two-digit day and month,
 * and a four-digit year only (a two-digit year would be ambiguous).
 */
export function parseDateInput(text: string): { iso: string } | { error: DateInputError } | { empty: true } {
  const s = text.trim()
  if (!s) return { empty: true }
  const m = /^(\d{1,2})([/.])(\d{1,2})\2(\d{4})$/.exec(s)
  if (!m) return { error: 'date_format' }
  const [day, month, year] = [Number(m[1]), Number(m[3]), Number(m[4])]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return { error: 'date_invalid' }
  return { iso: `${year}-${pad(month)}-${pad(day)}` }
}

/** Typed 24-hour time → [hours, minutes]. '9:05' and '09:05' are fine; '9pm' is not. */
export function parseTimeInput(text: string): [number, number] | { error: 'time_format' } | { empty: true } {
  const s = text.trim()
  if (!s) return { empty: true }
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: 'time_format' }
  return [Number(m[1]), Number(m[2])]
}

/** A calendar date plus a local wall-clock time → the ISO instant (UTC) the API expects. */
export function localDateTimeToIso(isoDay: string, [hours, minutes]: [number, number]): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  return new Date(y, m - 1, d, hours, minutes).toISOString()
}

/** Today in the viewer's time zone, as 'YYYY-MM-DD'. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
