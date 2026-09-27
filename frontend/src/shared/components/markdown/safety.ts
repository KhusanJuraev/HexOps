import { defaultUrlTransform } from 'react-markdown'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

/**
 * Raw HTML in Markdown is shown as literal text: never parsed, never executed.
 * (Dropping it would hide payloads that a security write-up needs to show.)
 */
export function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text'
    node.children?.forEach(walk)
  }
  return walk
}

/** Allow only http(s), mailto and in-page/relative links; everything else becomes "". */
export function safeUrl(url: string): string {
  const cleaned = defaultUrlTransform(url) // strips javascript:, vbscript:, data:, …
  if (!cleaned) return ''
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)?.[1]?.toLowerCase()
  return !scheme || ['http', 'https', 'mailto'].includes(scheme) ? cleaned : ''
}
