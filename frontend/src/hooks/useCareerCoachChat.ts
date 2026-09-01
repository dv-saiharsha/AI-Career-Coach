'use client'

/**
 * All Career Coach chat state and streaming logic, decoupled from any one
 * page — the /coach page uses this today, and the planned Phase 2 floating
 * assistant is meant to reuse this exact hook rather than duplicating the
 * send/stream/persist flow for a second surface.
 *
 * Conversation list and message history are ordinary TanStack Query reads
 * (this app's established convention for server state — see
 * useRealtimeStream.ts's own invalidation pattern). The one piece that
 * genuinely doesn't fit useQuery/useMutation is the in-flight streamed
 * reply itself: token-by-token updates aren't a single request/response, so
 * that stays local state, seeded from the query and reconciled with the
 * server via invalidation once a turn completes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createCoachConversation,
  deleteCoachConversation,
  getCoachMessages,
  listCoachConversations,
  streamCoachMessage,
  type CoachMessage,
} from '@/lib/apiClient'

export interface ChatMessage extends CoachMessage {
  /** True only for the assistant message currently receiving token events. */
  streaming?: boolean
}

const CONVERSATIONS_KEY = ['coach', 'conversations'] as const
const messagesKey = (conversationId: number) => ['coach', 'messages', conversationId] as const

export function useCoachConversations() {
  return useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: listCoachConversations })
}

export function useCreateCoachConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createCoachConversation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
  })
}

export function useDeleteCoachConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteCoachConversation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
  })
}

interface UseCareerCoachChatOptions {
  conversationId: number | null
  /** Called once, synchronously with the new id, the moment sending a
   *  message with no conversation selected creates one. */
  onConversationCreated?: (id: number) => void
}

export function useCareerCoachChat({ conversationId, onConversationCreated }: UseCareerCoachChatOptions) {
  const queryClient = useQueryClient()
  const history = useQuery({
    queryKey: conversationId != null ? messagesKey(conversationId) : ['coach', 'messages', 'none'],
    queryFn: () => getCoachMessages(conversationId as number),
    enabled: conversationId != null,
  })

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  // Set right before onConversationCreated fires so the seeding effect below
  // recognizes "this id change is one I already have local state for" and
  // doesn't clobber the in-progress streamed reply with the (still-empty)
  // server history for a conversation that was only just created.
  const justCreatedRef = useRef<number | null>(null)

  // Switching conversations (including starting a new chat) always cancels
  // whatever was in flight for the previous one, and seeds local state from
  // whatever the query already has cached — necessary because this hook's
  // `messages` is not purely derived from the query (an active stream must
  // be able to update it token-by-token without waiting on a refetch).
  useEffect(() => {
    // Checked FIRST, before touching any state: this conversationId change
    // may be the one send() itself just caused (creating a new conversation
    // for the very message currently streaming). In that case send() is
    // still actively driving `sending`/`sendError`/`messages` — resetting
    // them here raced the in-flight turn and could wipe an error message
    // (or the streamed reply) the instant it was set.
    if (conversationId != null && conversationId === justCreatedRef.current) {
      justCreatedRef.current = null
      return
    }
    abortRef.current?.abort()
    setSending(false)
    setSendError('')
    setMessages(history.data ?? [])
    // Deliberately conversationId-only: history.data updating on its own is
    // handled by the effect below, which additionally guards against
    // clobbering an in-progress stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // Re-syncs once the history query actually resolves for the conversation
  // currently selected — covers both the initial load (data arrives after
  // the effect above's first pass) and the post-turn invalidation in send().
  useEffect(() => {
    if (conversationId == null || sending) return
    if (conversationId === justCreatedRef.current) return // no real history to fetch yet
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciling local state with a background query refetch, not a per-render mirror
    if (history.data) setMessages(history.data)
  }, [history.data, conversationId, sending])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || sending) return

      let targetId = conversationId
      if (targetId == null) {
        try {
          const conversation = await createCoachConversation()
          targetId = conversation.id
          justCreatedRef.current = targetId
          queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
          onConversationCreated?.(targetId)
        } catch {
          setSendError('Could not start a new conversation. Check that the API is running.')
          return
        }
      }

      setSendError('')
      setSending(true)
      const now = new Date().toISOString()
      const assistantId = -Date.now() // negative so it never collides with a real persisted id
      setMessages((prev) => [
        ...prev,
        { id: assistantId - 1, role: 'user', content: trimmed, follow_ups: [], created_at: now },
        { id: assistantId, role: 'assistant', content: '', follow_ups: [], created_at: now, streaming: true },
      ])

      const controller = new AbortController()
      abortRef.current = controller
      try {
        await streamCoachMessage(targetId, trimmed, {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'token') {
              const { text: chunk } = event.data as { text: string }
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
              )
            } else if (event.type === 'followups') {
              const { items } = event.data as { items: string[] }
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, follow_ups: items, streaming: false } : m)),
              )
            } else if (event.type === 'error') {
              const { message } = event.data as { message: string }
              setSendError(message)
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
            }
          },
        })
      } catch {
        if (!controller.signal.aborted) {
          setSendError('Lost connection to the Career Coach. Check that the API is running and try again.')
        }
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
      } finally {
        setSending(false)
        // Reconciles the cache with server truth (the derived title, the
        // real persisted ids) — local state already reflects the reply, so
        // this is a background sync, not something the UI waits on.
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
        if (targetId != null) queryClient.invalidateQueries({ queryKey: messagesKey(targetId) })
      }
    },
    [conversationId, sending, onConversationCreated, queryClient],
  )

  const sendFollowUp = useCallback((text: string) => void send(text), [send])

  return {
    messages,
    loadingHistory: history.isLoading,
    historyError: history.isError ? 'Could not load this conversation. Check that the API is running.' : '',
    sending,
    sendError,
    send,
    sendFollowUp,
  }
}
