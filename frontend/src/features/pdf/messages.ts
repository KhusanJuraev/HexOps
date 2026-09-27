import i18n, { type TFunction } from 'i18next'

/** A job's error_code as a sentence (errors.codes.*), like any other API error. */
export function jobErrorMessage(t: TFunction, code: string | null): string {
  const key = `errors.codes.${code}`
  return code && i18n.exists(key) ? t(key) : t('pdf.failed')
}

/** An import warning code (pdf_tables_detected, …) as a sentence. */
export function warningMessage(t: TFunction, code: string): string {
  const key = `pdf.warnings.${code}`
  return i18n.exists(key) ? t(key) : code
}
