import { describe, expect, it, vi } from 'vitest'

import { api, ApiError, isUnreachable, UNREACHABLE } from './client'

function mockFetch(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body)
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(payload, { status, headers }))
}

describe('api client', () => {
  it('sends the CSRF cookie value as a header on state-changing requests', async () => {
    document.cookie = 'hexops_csrf=abc123; path=/'
    const fetchSpy = mockFetch(200, { ok: true })
    await api('/api/x', { method: 'POST', body: { a: 1 } })
    const init = fetchSpy.mock.calls[0][1]!
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('abc123')
    expect(init.credentials).toBe('same-origin')
  })

  it('does not send the CSRF header on GET', async () => {
    document.cookie = 'hexops_csrf=abc123; path=/'
    const fetchSpy = mockFetch(200, {})
    await api('/api/x')
    expect(fetchSpy.mock.calls[0][1]!.headers).not.toHaveProperty('X-CSRF-Token')
  })

  it('parses the error envelope: status, code, field errors and Retry-After', async () => {
    mockFetch(422, {
      detail: 'Request validation failed',
      code: 'validation_error',
      errors: [{ field: 'username', code: 'missing', params: {} }],
    })
    const err = await api('/api/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'validation_error', errors: [{ field: 'username', code: 'missing' }] })

    mockFetch(429, { detail: 'slow down', code: 'rate_limited' }, { 'Retry-After': '42' })
    await expect(api('/api/x')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 42 })
  })

  it('treats a network failure as unreachable, not as an auth error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await api('/api/auth/me').catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 0, code: UNREACHABLE })
    expect(isUnreachable(err)).toBe(true)
  })

  it('treats a bare 5xx (proxy error page) as unreachable, but not a HexOps 500', async () => {
    mockFetch(500, '')
    expect(isUnreachable(await api('/api/x').catch((e: unknown) => e))).toBe(true)
    mockFetch(502, '<html>Bad gateway</html>')
    expect(isUnreachable(await api('/api/x').catch((e: unknown) => e))).toBe(true)
    mockFetch(500, { detail: 'Internal server error', code: 'internal_error' })
    await expect(api('/api/x')).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('re-throws aborts untouched', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(api('/api/x')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('returns undefined for 204 responses', async () => {
    mockFetch(204)
    await expect(api('/api/x', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})
