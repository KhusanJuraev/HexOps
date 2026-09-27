import { ImageIcon } from 'lucide-react'
import { createElement, useMemo, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

import { cn } from '@/shared/lib/utils'

import { ALIASES, LANGUAGES } from './languages'
import { remarkHtmlAsText, safeUrl } from './safety'

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

function components(headingOffset: number): Components {
  // Markdown "#" becomes h3 by default: the page owns h1 and its sections h2.
  const heading = (level: number) =>
    function Heading({ node: _node, ...props }: ComponentProps<'h1'> & { node?: unknown }) {
      return createElement(HEADINGS[Math.min(5, level - 1 + headingOffset)], props)
    }
  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    a({ node: _node, href, children, ...props }) {
      if (!href) return <span className="md-dead-link">{children}</span>
      const external = /^(https?:|mailto:)/i.test(href)
      return (
        <a href={href} {...props} {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}>
          {children}
        </a>
      )
    },
    // Images are never fetched: a remote image would reveal that the note was
    // opened (and from where). Shown as a link the user can choose to follow.
    img({ src, alt }) {
      const href = typeof src === 'string' ? safeUrl(src) : ''
      const label: ReactNode = (
        <>
          <ImageIcon className="inline size-3.5 align-[-2px]" aria-hidden="true" /> {alt || href || 'image'}
        </>
      )
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="md-image-link">
          {label}
        </a>
      ) : (
        <span className="md-image-link">{label}</span>
      )
    },
    // Wide tables scroll inside the pane instead of widening the page.
    table({ node: _node, ...props }) {
      return (
        <div className="md-table-wrap">
          <table {...props} />
        </div>
      )
    },
  }
}

interface Props {
  source: string
  className?: string
  /** 2 → Markdown "#" renders as h3. */
  headingOffset?: number
}

/** Safe Markdown rendering (GFM tables, task lists, strikethrough, highlighted code). */
export function MarkdownView({ source, className, headingOffset = 2 }: Props) {
  const parts = useMemo(() => components(headingOffset), [headingOffset])
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHtmlAsText]}
        rehypePlugins={[[rehypeHighlight, { languages: LANGUAGES, aliases: ALIASES, detect: false, plainText: ['plaintext'] }]]}
        urlTransform={safeUrl}
        components={parts}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
