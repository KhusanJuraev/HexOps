import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Highlight } from './Highlight'

const marks = (text: string, terms: string[]) => {
  const { container } = render(<Highlight text={text} terms={terms} />)
  return { marks: [...container.querySelectorAll('mark')].map((m) => m.textContent), html: container.innerHTML, text: container.textContent }
}

describe('Highlight', () => {
  it('marks terms case-insensitively and keeps the text intact', () => {
    const r = marks('Found SQLi in sqli.example.com', ['sqli'])
    expect(r.marks).toEqual(['SQLi', 'sqli'])
    expect(r.text).toBe('Found SQLi in sqli.example.com')
  })

  it('treats Uzbek apostrophes as optional', () => {
    expect(marks('Tizimga koʻrinish va ko‘rinish', ['korinish']).marks).toEqual(['koʻrinish', 'ko‘rinish'])
  })

  it('escapes regex characters in terms', () => {
    expect(marks('see 10.0.0.5 not 10a0b0c5', ['10.0.0.5']).marks).toEqual(['10.0.0.5'])
    expect(marks('a (b) c', ['(b)']).marks).toEqual(['(b)'])
  })

  it('never turns text into HTML', () => {
    const r = marks('<img src=x onerror=alert(1)> payload', ['payload'])
    expect(r.html).not.toContain('<img')
    expect(r.text).toContain('<img src=x onerror=alert(1)>')
  })

  it('ignores one-character terms', () => {
    expect(marks('a b c', ['a']).marks).toEqual([])
  })
})
