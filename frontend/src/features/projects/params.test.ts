import { describe, expect, it } from 'vitest'

import { DEFAULT_QUERY, toSearchParams } from './api'
import { parseProjectId, parseQuery } from './params'

describe('project list URL state', () => {
  it('reads known values and ignores anything unexpected', () => {
    const q = parseQuery(new URLSearchParams('q=acme&type=pentest_client&status=closed&sort=name&order=asc&page=3'))
    expect(q).toEqual({ q: 'acme', type: 'pentest_client', status: 'closed', sort: 'name', order: 'asc', page: 3 })
    const junk = parseQuery(new URLSearchParams('type=hobby&status=x&sort=password&order=up&page=-2'))
    expect(junk).toEqual(DEFAULT_QUERY)
    expect(parseQuery(new URLSearchParams(`q=${'x'.repeat(500)}`)).q).toHaveLength(200)
  })

  it('writes only non-default values', () => {
    expect(toSearchParams(DEFAULT_QUERY).toString()).toBe('')
    expect(toSearchParams({ ...DEFAULT_QUERY, q: 'a b', page: 2 }).toString()).toBe('q=a+b&page=2')
  })

  it('accepts only positive integer ids', () => {
    expect(parseProjectId('42')).toBe(42)
    for (const bad of [undefined, '', '0', '-1', '1.5', '1e3', 'abc', '99999999999']) expect(parseProjectId(bad)).toBeNull()
  })
})
