'use client'

import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import type { ChatMessage } from '@/hooks/useCareerCoachChat'
import { CoachMarkdown } from './CoachMarkdown'

const EASE = [0.22, 1, 0.36, 1] as const

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
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="flex justify-end"
      >
        <div className="max-w-[80%] rounded-[14px] rounded-tr-[4px] bg-(--color-ink) px-4 py-2.5">
          <p className="text-sm text-(--color-on-accent) leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
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
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-(--color-ink-faint)"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
              />
            ))}
          </span>
        ) : null}
      </div>
    </motion.div>
  )
}
