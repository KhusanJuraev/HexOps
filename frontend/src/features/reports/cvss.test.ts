import { describe, expect, it } from 'vitest'

import { ratingForScore } from './cvss'

describe('CVSS qualitative rating (a hint only)', () => {
  it.each([
    ['0.0', 'info'],
    ['0.1', 'low'],
    ['3.9', 'low'],
    ['4.0', 'medium'],
    ['6.9', 'medium'],
    ['7.0', 'high'],
    ['8.9', 'high'],
    ['9.0', 'critical'],
    ['10', 'critical'],
  ])('%s → %s', (score, rating) => expect(ratingForScore(score)).toBe(rating))

  it.each([null, '', ' ', 'abc', '11', '-1'])('no hint for %s', (score) => expect(ratingForScore(score)).toBeNull())
})
