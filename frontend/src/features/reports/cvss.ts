import type { Severity } from './types'

/**
 * The CVSS v3/v4 qualitative rating for a base score. Shown as a hint next to the
 * researcher's own severity; it never changes what was entered (D-61).
 */
export function ratingForScore(score: string | null): Severity | null {
  if (score === null || score.trim() === '') return null
  const n = Number(score)
  if (!Number.isFinite(n) || n < 0 || n > 10) return null
  if (n === 0) return 'info' // CVSS "None"
  if (n < 4) return 'low'
  if (n < 7) return 'medium'
  if (n < 9) return 'high'
  return 'critical'
}
