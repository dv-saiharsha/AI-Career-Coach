'use client'

/**
 * Record → Stop → Deepgram transcription → hand the transcript to the
 * parent's existing answer composer. Once `onTranscriptReady` fires, the
 * parent's ordinary Textarea + Submit button ARE the transcript-preview /
 * edit / accept step — this component doesn't duplicate that UI, it only
 * owns what's genuinely voice-specific: capture, replay, and re-record.
 *
 * MediaRecorder (not the browser's SpeechRecognition API) is used purely for
 * capture — it has real cross-browser support (Chrome/Firefox/Safari 16+/
 * Edge), unlike in-page speech recognition, which is effectively Chrome-only.
 */

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react'
import { transcribeInterviewAnswer, type VoiceMetrics } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'

type Phase = 'idle' | 'recording' | 'paused' | 'transcribing' | 'ready' | 'error' | 'unsupported' | 'permission-denied'

// Candidates in preference order — Chrome/Firefox default to the first,
// Safari (16+) only supports mp4/AAC. Whichever the browser accepts is sent
// to Deepgram as-is; both formats are natively supported server-side, so no
// transcoding step exists anywhere in this pipeline.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

// A hard ceiling, not a UX nudge — bounds both cost and how long a user can
// accidentally leave a recording running.
const MAX_RECORDING_MS = 5 * 60 * 1000

// Wall-clock reads belong to event handlers and timers here, never to a
// render — isolated in its own function so the lint rule that flags impure
// calls inside a component body doesn't need to trace call sites to know
// that (the same reason ConversationSidebar.tsx's relativeLabel is a
// module-level helper rather than inlined).
function now(): number {
  return Date.now()
}

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

interface VoiceAnswerComposerProps {
  disabled?: boolean
  onTranscriptReady: (transcript: string, metrics: VoiceMetrics) => void
  onReset: () => void
}

export function VoiceAnswerComposer({ disabled, onTranscriptReady, onReset }: VoiceAnswerComposerProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [uploadPercent, setUploadPercent] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [recordedDurationMs, setRecordedDurationMs] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef<string>('audio/webm')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const pausedAccumRef = useRef(0)

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, [])

  const stopTicking = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const tick = () => {
    const elapsed = pausedAccumRef.current + (now() - startedAtRef.current)
    setElapsedMs(elapsed)
    if (elapsed >= MAX_RECORDING_MS) {
      stopRecording()
    }
  }

  const startRecording = async () => {
    setErrorMessage('')
    const mimeType = pickSupportedMimeType()
    if (!mimeType) {
      setPhase('unsupported')
      return
    }
    mimeTypeRef.current = mimeType

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setPhase('permission-denied')
      return
    }

    streamRef.current = stream
    chunksRef.current = []
    const recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
    }
    mediaRecorderRef.current = recorder
    recorder.start()

    startedAtRef.current = now()
    pausedAccumRef.current = 0
    setElapsedMs(0)
    setPhase('recording')
    intervalRef.current = setInterval(tick, 250)
  }

  const pauseRecording = () => {
    mediaRecorderRef.current?.pause()
    pausedAccumRef.current += now() - startedAtRef.current
    stopTicking()
    setPhase('paused')
  }

  const resumeRecording = () => {
    mediaRecorderRef.current?.resume()
    startedAtRef.current = now()
    setPhase('recording')
    intervalRef.current = setInterval(tick, 250)
  }

  const stopRecording = () => {
    stopTicking()
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    const finalDuration = pausedAccumRef.current + (recorder.state === 'paused' ? 0 : now() - startedAtRef.current)
    recorder.addEventListener(
      'stop',
      () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current })
        setAudioUrl(URL.createObjectURL(blob))
        setRecordedDurationMs(finalDuration)
        void transcribe(blob)
      },
      { once: true },
    )
    recorder.stop()
  }

  const transcribe = async (blob: Blob) => {
    setPhase('transcribing')
    setUploadPercent(0)
    try {
      const extension = mimeTypeRef.current.includes('mp4') ? 'm4a' : mimeTypeRef.current.includes('ogg') ? 'ogg' : 'webm'
      const { transcript, voice_metrics } = await transcribeInterviewAnswer(
        blob,
        `answer.${extension}`,
        setUploadPercent,
      )
      setPhase('ready')
      onTranscriptReady(transcript, voice_metrics)
    } catch (err) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Could not transcribe that recording. Check your connection and try again.'
      setErrorMessage(message)
      setPhase('error')
    }
  }

  const reRecord = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setElapsedMs(0)
    setRecordedDurationMs(0)
    setErrorMessage('')
    setPhase('idle')
    onReset()
  }

  if (phase === 'unsupported') {
    return (
      <div className="flex items-start gap-2 text-sm text-(--color-error) border-l-[3px] border-(--color-error) pl-3 py-1.5">
        <AlertCircle strokeWidth={1.5} className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        Voice recording isn&apos;t supported in this browser. Switch to Text mode above to continue.
      </div>
    )
  }

  if (phase === 'permission-denied') {
    return (
      <div className="flex items-start gap-2 text-sm text-(--color-error) border-l-[3px] border-(--color-error) pl-3 py-1.5">
        <AlertCircle strokeWidth={1.5} className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Microphone access was denied. Allow microphone access for this site in your browser settings, then{' '}
          <button type="button" onClick={() => setPhase('idle')} className="underline underline-offset-2">
            try again
          </button>
          .
        </span>
      </div>
    )
  }

  if (phase === 'idle') {
    return (
      <div className="flex items-center gap-3">
        <Button type="button" onClick={startRecording} disabled={disabled} className="gap-2">
          <Mic strokeWidth={1.5} className="w-4 h-4" />
          Record answer
        </Button>
        <span className="text-xs text-(--color-ink-faint)">Up to 5 minutes per answer.</span>
      </div>
    )
  }

  if (phase === 'recording' || phase === 'paused') {
    return (
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <span className="relative flex h-2.5 w-2.5">
          {phase === 'recording' && (
            <motion.span
              className="absolute inline-flex h-full w-full rounded-full bg-(--color-error)"
              animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.8, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <span
            className="relative inline-flex h-2.5 w-2.5 rounded-full"
            style={{ background: phase === 'recording' ? 'var(--color-error)' : 'var(--color-ink-faint)' }}
          />
        </span>
        <span className="font-mono text-sm text-(--color-ink) tabular-nums">{formatDuration(elapsedMs)}</span>
        <span className="text-xs text-(--color-ink-faint)">{phase === 'paused' ? 'Paused' : 'Recording…'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {phase === 'recording' ? (
            <Button type="button" variant="ghost" size="icon-sm" onClick={pauseRecording} aria-label="Pause recording">
              <Pause strokeWidth={1.5} className="w-4 h-4" />
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon-sm" onClick={resumeRecording} aria-label="Resume recording">
              <Play strokeWidth={1.5} className="w-4 h-4" />
            </Button>
          )}
          <Button type="button" size="sm" onClick={stopRecording} className="gap-1.5">
            <Square strokeWidth={1.5} className="w-3.5 h-3.5" />
            Stop
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'transcribing') {
    return (
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <span className="w-4 h-4 rounded-full border-2 border-(--color-ink-faint)/30 border-t-(--color-ink) animate-spin shrink-0" />
        <span className="text-sm text-(--color-ink-dim)">
          {uploadPercent < 100 ? `Uploading… ${uploadPercent}%` : 'Transcribing…'}
        </span>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-(--color-error) border-l-[3px] border-(--color-error) pl-3 py-1.5">
          <AlertCircle strokeWidth={1.5} className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          {errorMessage}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={reRecord} className="gap-1.5 shrink-0">
          <RotateCcw strokeWidth={1.5} className="w-3.5 h-3.5" />
          Re-record
        </Button>
      </div>
    )
  }

  // ready — transcript already handed to the parent; this is just the
  // replay/re-record strip sitting above the parent's own edit+submit UI.
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs text-(--color-ink-faint) font-mono">{formatDuration(recordedDurationMs)}</span>
      {audioUrl && (
        // Native controls, deliberately — accessible play/pause/seek for
        // free, and this is a one-off utility, not a custom player worth
        // building.
        <audio controls src={audioUrl} className="h-8 max-w-[220px]" aria-label="Replay your recording" />
      )}
      <Button type="button" variant="ghost" size="sm" onClick={reRecord} disabled={disabled} className="gap-1.5">
        <RotateCcw strokeWidth={1.5} className="w-3.5 h-3.5" />
        Re-record
      </Button>
    </div>
  )
}
