'use client'

import { Sparkles } from 'lucide-react'
import type { ChatMessage } from '@/hooks/useCareerCoachChat'
import dynamic from 'next/dynamic'

/* react-markdown and remark-gfm are ~22KB gzipped and are the only reason
   /coach exceeded its class budget. Nothing renders markdown until an
   assistant reply exists, and the user's own messages are plain text, so the
   parser loads on the first reply rather than with the route. The fallback
   is the raw text in the same type — visible and readable, just unstyled,
   for the moment the chunk is in flight. */
const CoachMarkdown = dynamic(
  () => import('./CoachMarkdown').then((m) => m.CoachMarkdown),
  {
    ssr: false,
    loading: () => null,
  },
)
import { Reveal } from '@/lib/reveal'


export function FollowUpChips({ items, onPick, disabled }: { items: string[]; onPick: (text: string) => void; disabled: boolean }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          disabled={disabled}
          onClick={() => onPick(item)}
          className="chip transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:border-(--color-accent) hover:text-(--color-accent)"
        >
          {item}
        </button>
      ))}
    </div>
  )
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <Reveal
       
       
       
        className="flex justify-end"
      >
        <div className="max-w-[80%] rounded-[14px] rounded-tr-[4px] bg-(--color-ink) px-4 py-2.5">
          <p className="text-sm text-(--color-on-accent) leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </Reveal>
    )
  }

  return (
    <Reveal
     
     
     
      className="flex items-start gap-2.5"
    >
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--color-accent-tint)">
        <Sparkles strokeWidth={1.5} className="h-3.5 w-3.5 text-(--color-accent)" />
      </span>
      <div className="min-w-0 max-w-[85%] rounded-[14px] rounded-tl-[4px] border border-(--color-canvas-line) bg-(--color-canvas) px-4 py-3">
        {message.content ? (
          <CoachMarkdown content={message.content} />
        ) : message.streaming ? (
          <span className="inline-flex gap-1 py-1" aria-label="Thinking">
            {[0, 1, 2].map((i) => (
              <Reveal as="span"
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-(--color-ink-faint)"
               
               
              />
            ))}
          </span>
        ) : null}
      </div>
    </Reveal>
  )
}
