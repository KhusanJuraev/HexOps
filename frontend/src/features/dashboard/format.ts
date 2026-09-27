import i18n from 'i18next'

const locale = () => i18n.resolvedLanguage ?? 'en'

// Months come from the shared formatter (it handles Uzbek itself).
export { formatMonth as monthLabel } from '@/shared/lib/format'

/** An amount in ONE currency. Amounts in different currencies are never combined. */
export function money(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(Number(amount))
  } catch {
    return `${amount} ${currency}`
  }
}

export const count = (n: number) => new Intl.NumberFormat(locale()).format(n)
