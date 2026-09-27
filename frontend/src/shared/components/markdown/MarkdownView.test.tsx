import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownView } from './MarkdownView'
import { safeUrl } from './safety'

const view = (source: string) => render(<MarkdownView source={source} />).container

describe('MarkdownView: safe rendering', () => {
  it('shows raw HTML as text and never creates elements from it', () => {
    const c = view(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://evil.example"></iframe>\n\nHi <b onclick="alert(1)">bold</b>',
    )
    expect(c.querySelector('script, iframe, b, [onerror], [onclick]')).toBeNull()
    expect(c.querySelectorAll('img')).toHaveLength(0)
    expect(c.textContent).toContain('<script>alert(1)</script>')
    expect(c.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/x',
  ])('drops unsafe link target %j', (href) => {
    const c = view(`[click me](${href.replace(/ /g, '%20')}) and <${href}>`)
    for (const a of c.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/script|data:|file:|ftp:/i)
    expect(c.textContent).toContain('click me')
  })

  it('keeps safe links, opening external ones without referrer or opener', () => {
    const c = view('[site](https://example.com/a?b=1) [mail](mailto:a@b.c) [anchor](#steps) [rel](/reports/1)')
    const links = [...c.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.getAttribute('rel'), a.getAttribute('target')])
    expect(links).toEqual([
      ['https://example.com/a?b=1', 'noopener noreferrer nofollow', '_blank'],
      ['mailto:a@b.c', 'noopener noreferrer nofollow', '_blank'],
      ['#steps', null, null],
      ['/reports/1', null, null],
    ])
  })

  it('never loads images: they become links (or text for unsafe sources)', () => {
    const c = view('![screenshot](https://tracker.example/pixel.png) ![bad](javascript:alert(1))')
    expect(c.querySelectorAll('img')).toHaveLength(0)
    const [link] = c.querySelectorAll('a')
    expect(link.getAttribute('href')).toBe('https://tracker.example/pixel.png')
    expect(c.textContent).toContain('screenshot')
    expect(c.textContent).toContain('bad')
  })

  it('renders headings one level below the page, tables in a scroll wrapper, task lists', () => {
    const c = view('# Title\n\n## Sub\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~')
    expect(c.querySelector('h3')?.textContent).toBe('Title')
    expect(c.querySelector('h4')?.textContent).toBe('Sub')
    expect(c.querySelector('h1, h2')).toBeNull()
    expect(c.querySelector('.md-table-wrap > table td')?.textContent).toBe('1')
    const boxes = c.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    expect([...boxes].map((b) => [b.checked, b.disabled])).toEqual([[true, true], [false, true]])
    expect(c.querySelector('del')?.textContent).toBe('old')
  })

  it('highlights fenced code for known languages and aliases, leaves others plain', () => {
    const c = view('```python\nimport os\n```\n\n```sh\nnmap -sV host\n```\n\n```brainfuck\n++[>+<-]\n```')
    const blocks = [...c.querySelectorAll('pre code')]
    expect(blocks[0].className).toContain('language-python')
    expect(blocks[0].querySelector('.hljs-keyword')?.textContent).toBe('import')
    expect(blocks[1].className).toContain('hljs')
    expect(blocks[2].querySelector('[class^="hljs-"]')).toBeNull()
    expect(blocks[2].textContent).toBe('++[>+<-]\n')
  })

  it('code keeps HTML payloads as literal text', () => {
    const c = view('```html\n<svg onload=alert(1)>\n```\n\nInline `<img src=x onerror=alert(1)>`')
    expect(c.querySelector('svg, img')).toBeNull()
    expect(c.textContent).toContain('<svg onload=alert(1)>')
  })
})

describe('safeUrl', () => {
  it.each([
    ['https://a.b/c', 'https://a.b/c'],
    ['http://a.b', 'http://a.b'],
    ['mailto:x@y.z', 'mailto:x@y.z'],
    ['#frag', '#frag'],
    ['/relative', '/relative'],
    ['javascript:alert(1)', ''],
    ['data:image/png;base64,AA', ''],
    ['blob:https://a.b/1', ''],
    ['tel:+1', ''],
  ])('%s → %j', (input, expected) => expect(safeUrl(input)).toBe(expected))
})
