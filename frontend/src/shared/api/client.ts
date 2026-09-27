const CSRF_COOKIE = 'hexops_csrf'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Code used when no HexOps API answered (network failure or a proxy error page). */
export const UNREACHABLE = 'backend_unreachable'

export interface FieldError {
  field: string
  code: string
  params?: Record<string, string | number | boolean>
}

/** The backend's error envelope (backend/app/errors.py). */
interface ErrorBody {
  detail: string
  code: string
  errors?: FieldError[]
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly errors: FieldError[]
  readonly retryAfter: number | null

  constructor(status: number, code: string, message: string, errors: FieldError[] = [], retryAfter: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.errors = errors
    this.retryAfter = retryAfter
  }
}

/** True when the request never reached HexOps, as opposed to HexOps refusing it. */
export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.code === UNREACHABLE
}

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function isErrorBody(value: unknown): value is ErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ErrorBody).code === 'string' &&
    typeof (value as ErrorBody).detail === 'string'
  )
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

/** Same-origin JSON client. Adds the CSRF header to every state-changing request. */
export async function api<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}) {
  const headers: Record<string, string> = { Accept: 'application/json' }
  // FormData (file uploads) sets its own multipart Content-Type with the boundary.
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, UNREACHABLE, 'Network request failed')
  }

  if (!res.ok) {
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      // Not JSON: an error page from a proxy (e.g. the Vite dev server when the API is down).
    }
    const retryAfter = Number(res.headers.get('Retry-After')) || null
    if (isErrorBody(parsed)) {
      throw new ApiError(res.status, parsed.code, parsed.detail, parsed.errors ?? [], retryAfter)
    }
    // Every HexOps error carries the envelope, so a bare 5xx came from something in front of it.
    const code = res.status >= 500 ? UNREACHABLE : 'error'
    throw new ApiError(res.status, code, res.statusText || `HTTP ${res.status}`, [], retryAfter)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
