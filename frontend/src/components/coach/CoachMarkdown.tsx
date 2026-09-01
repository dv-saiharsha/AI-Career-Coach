'use client'

import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Renders one chat message's Markdown. Internal links (the coach is
 * instructed to reference other modules by their real app paths — see
 * career_coach/chat.py's system prompt) use Next's Link for a client-side
 * transition instead of a full page reload; anything else opens in a new
 * tab, since it left the app.
 *
 * No syntax-highlighter: replies are coaching prose with the occasional
 * short snippet, not a code viewer, so a plain monospace block matches this
 * app's minimalist aesthetic without the bundle weight of a highlighter and
 * its themes.
 */
const COMPONENTS: Components = {
  a: ({ href, children, ...props }) => {
    if (href?.startsWith('/')) {
      return (
        <Link href={href} className="text-(--color-accent) underline underline-offset-2">
          {children}
        </Link>
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-(--color-accent) underline underline-offset-2"
        {...props}
      >
        {children}
      </a>
    )
  },
  p: ({ children }) => <p className="text-sm text-(--color-ink) leading-relaxed mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1 text-sm text-(--color-ink) leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm text-(--color-ink) leading-relaxed">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-(--color-ink)">{children}</strong>,
  h1: ({ children }) => <h3 className="text-base font-display font-medium text-(--color-ink) mt-4 mb-2 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="text-base font-display font-medium text-(--color-ink) mt-4 mb-2 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="text-sm font-semibold text-(--color-ink) mt-3 mb-1.5 first:mt-0">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-[3px] border-(--color-canvas-line) pl-3 py-0.5 my-3 text-sm text-(--color-ink-dim)">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    // remark assigns a language-xxx class to fenced blocks (multi-line);
    // inline code has none — that distinction is what decides the styling.
    const isBlock = Boolean(className)
    if (!isBlock) {
      return (
        <code
          className="rounded-[4px] bg-(--color-canvas-raise) px-1.5 py-0.5 font-mono text-[0.8em] text-(--color-ink)"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code className="font-mono text-xs leading-relaxed text-(--color-ink)" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-[10px] bg-(--color-canvas-raise) border border-(--color-canvas-line) p-3">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-(--color-canvas-line) px-2 py-1.5 text-left font-medium text-(--color-ink)">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-(--color-canvas-line) px-2 py-1.5 text-(--color-ink-subtle)">{children}</td>,
}

export function CoachMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
