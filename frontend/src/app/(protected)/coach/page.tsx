'use client'

import { useEffect, useRef, useState } from 'react'
import { Menu, Send, Sparkles } from 'lucide-react'
import {
  useCareerCoachChat,
  useCoachConversations,
  useDeleteCoachConversation,
} from '@/hooks/useCareerCoachChat'
import { ConversationSidebar } from '@/components/coach/ConversationSidebar'
import { MessageBubble, FollowUpChips } from '@/components/coach/MessageBubble'
import { InlineError } from '@/components/resume/InlineError'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'

const STARTER_PROMPTS = [
  'How is my resume looking overall?',
  'What should I practice before my next interview?',
  'Explain my latest ATS score',
  'What should I do next?',
]

export default function CareerCoachPage() {
  const [activeId, setActiveId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const conversations = useCoachConversations()
  const deleteConversation = useDeleteCoachConversation()
  const { messages, loadingHistory, historyError, sending, sendError, send, sendFollowUp } = useCareerCoachChat({
    conversationId: activeId,
    onConversationCreated: setActiveId,
  })

  const scrollAnchorRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [draft])

  // Handoff from Application Tracker's quick-prompt links
  // (/coach?prompt=...). Read once from window.location rather than
  // useSearchParams — the same one-shot pattern /interview's ?role= handoff
  // already uses — and pre-fills the composer without sending, so the user
  // can still edit before it goes out.
  useEffect(() => {
    const incoming = new URLSearchParams(window.location.search).get('prompt')?.trim()
    if (!incoming) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot seed from a query param, not a per-render mirror
    setDraft(incoming)
  }, [])

  const handleSend = () => {
    if (!draft.trim() || sending) return
    void send(draft)
    setDraft('')
  }

  const handleSelect = (id: number | null) => {
    setActiveId(id)
    setMobileSidebarOpen(false)
  }

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      await deleteConversation.mutateAsync(id)
      if (id === activeId) setActiveId(null)
    } finally {
      setDeletingId(null)
    }
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  return (
    <div className="flex h-full min-h-[70vh] gap-4">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 rounded-[14px] border border-(--color-canvas-line) bg-(--color-canvas-raise) md:block">
        <ConversationSidebar
          conversations={conversations.data ?? []}
          loading={conversations.isLoading}
          activeId={activeId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          deletingId={deletingId}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between md:hidden">
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Open conversations">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Conversations</SheetTitle>
              <ConversationSidebar
                conversations={conversations.data ?? []}
                loading={conversations.isLoading}
                activeId={activeId}
                onSelect={handleSelect}
                onDelete={handleDelete}
                deletingId={deletingId}
              />
            </SheetContent>
          </Sheet>
          <span className="eyebrow inline-flex items-center gap-1.5">
            <Sparkles strokeWidth={1.5} className="h-3 w-3" />
            Career Coach
          </span>
          <span className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto rounded-[14px] border border-(--color-canvas-line) bg-(--color-canvas) p-4 sm:p-6">
          {activeId == null && messages.length === 0 && !sending ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-(--color-accent-tint)">
                <Sparkles strokeWidth={1.5} className="h-6 w-6 text-(--color-accent)" />
              </span>
              <h1 className="text-xl font-display font-medium text-(--color-ink) mb-2">
                Your Career Coach
              </h1>
              <p className="max-w-sm text-sm text-(--color-ink-dim) leading-relaxed mb-6">
                Ask about your resume, your interview readiness, job matches, or what to do next —
                grounded in what you&apos;ve actually done in the app so far.
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="chip transition-colors hover:border-(--color-accent) hover:text-(--color-accent)"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : loadingHistory ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16 w-2/3" />
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-20 w-3/4" />
            </div>
          ) : historyError ? (
            <InlineError message={historyError} />
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((message) => (
                <div key={message.id}>
                  <MessageBubble message={message} />
                  {message.role === 'assistant' && message.id === lastAssistantId && !message.streaming && (
                    <div className="pl-9">
                      <FollowUpChips items={message.follow_ups} onPick={sendFollowUp} disabled={sending} />
                    </div>
                  )}
                </div>
              ))}
              <div ref={scrollAnchorRef} />
            </div>
          )}
        </div>

        <div className="mt-3">
            {sendError && (
              <div
               
               
               
                className="mb-2 overflow-hidden panel-enter"
              >
                <InlineError message={sendError} />
              </div>
            )}
          <div className="card flex items-end gap-2 p-3">
            <Textarea
              ref={textareaRef}
              aria-label="Message the Career Coach"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Ask your Career Coach anything…"
              rows={1}
              className="max-h-[144px] min-h-0 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:border-0 focus-visible:shadow-none"
            />
            <Button
              type="button"
              size="icon-sm"
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              aria-label="Send message"
            >
              <Send strokeWidth={1.5} className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
