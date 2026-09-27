import { describe, expect, it } from 'vitest'

/**
 * Modular-monolith import rules (docs/ADDING_A_MODULE.md):
 * - shared/ never imports features/ or app/;
 * - a feature never imports app/, and imports another feature only through its
 *   index (`@/features/<name>`), never its internal files;
 * - relative imports stay inside their own feature folder.
 */
const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.d.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function importsOf(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2])
}

function resolveRelative(file: string, spec: string): string {
  const parts = file.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

function violations(): string[] {
  const out: string[] = []
  for (const [file, source] of Object.entries(sources)) {
    const [, , area, feature] = file.split('/') // '', 'src', area, name
    for (const spec of importsOf(source)) {
      if (area === 'shared' && /^@\/(features|app)(\/|$)/.test(spec)) out.push(`${file} -> ${spec}`)
      if (area !== 'features') continue
      if (/^@\/app(\/|$)/.test(spec)) out.push(`${file} -> ${spec}`)
      const other = spec.match(/^@\/features\/([^/]+)(\/.*)?$/)
      if (other && other[1] !== feature && other[2]) out.push(`${file} -> ${spec} (use '@/features/${other[1]}')`)
      if (spec.startsWith('.') && !resolveRelative(file, spec).startsWith(`/src/features/${feature}/`)) {
        out.push(`${file} -> ${spec} (leaves the feature folder)`)
      }
    }
  }
  return out
}

describe('architecture', () => {
  it('scans the source tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30)
  })

  it('respects module boundaries', () => {
    expect(violations()).toEqual([])
  })
})

describe('dates (D-89)', () => {
  // Visible dates are DD/MM/YYYY (and HH:mm, 24-hour) in every language, made only by
  // shared/lib/format.ts and entered only through shared/components/DateInput.tsx.
  // Browser-locale formatting and native date pickers show MM/DD/YYYY on many systems.
  const FORBIDDEN = [
    /Intl\.DateTimeFormat/,
    /\.toLocale(Date|Time)String\(/,
    /type=["']date["']/,
    /type=["']datetime-local["']/,
    /type=["']month["']/,
  ]
  const ALLOWED = ['/src/shared/lib/format.ts']

  it('no module formats or enters dates on its own', () => {
    const offenders = Object.entries(sources)
      .filter(([file]) => !ALLOWED.includes(file) && !/\.test\.tsx?$/.test(file))
      .flatMap(([file, source]) => FORBIDDEN.filter((re) => re.test(source)).map((re) => `${file}: ${re}`))
    expect(offenders).toEqual([])
  })
})
