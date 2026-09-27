import { Fragment } from 'react'

const APOSTROPHES = /[ʻ‘’'`ʼ]/g
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Marks the given terms inside plain text. Output is React text nodes and <mark>
 * elements only: the text is never parsed as HTML.
 */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const usable = [...new Set(terms.map((t) => t.replace(APOSTROPHES, '')).filter((t) => t.length >= 2))]
  if (!usable.length) return <>{text}</>
  // Apostrophes are optional between letters, as in the search itself.
  const pattern = usable
    .sort((a, b) => b.length - a.length)
    .map((t) => [...t].map(escape).join(`${APOSTROPHES.source}?`))
    .join('|')
  const parts = text.split(new RegExp(`(${pattern})`, 'giu'))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-primary/15 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}
