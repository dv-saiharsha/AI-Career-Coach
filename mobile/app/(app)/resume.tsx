import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Screen, Card, Txt, Button, Field, styles } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import {
  ACCEPTED_TYPES,
  rejectionReason,
  uploadResume,
  type PickedFile,
  type UploadProgress,
} from '@/lib/upload'
import { useTheme, space, radius } from '@/theme'

interface HistoryItem {
  id: number
  resume_filename: string
  ats_score: number
  created_at: string
}

function band(score: number): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (score >= 75) return { label: 'Strong', tone: 'success' }
  if (score >= 45) return { label: 'Partial', tone: 'warning' }
  return { label: 'Needs work', tone: 'danger' }
}

/**
 * Score a CV, and see what previous ones came back as.
 *
 * The upload needs a job description as well as a file, because that is what
 * the backend scores against — /resume/analyze takes both. A score with no
 * posting behind it would be a number about nothing, so the field is
 * required here rather than defaulted to something plausible.
 */
export default function Resume() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()

  const [file, setFile] = useState<PickedFile | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [pickError, setPickError] = useState<string | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['resume', 'history'],
    queryFn: async () => (await api.get<HistoryItem[]>('/resume/history')).data,
  })

  const scan = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('No file selected')
      return uploadResume<{ ats_score: number }>(file, jobDescription.trim(), setProgress)
    },
    onSuccess: () => {
      setFile(null)
      setJobDescription('')
      setProgress(null)
      void queryClient.invalidateQueries({ queryKey: ['resume', 'history'] })
    },
    onError: () => setProgress(null),
  })

  async function pick() {
    setPickError(null)
    const result = await DocumentPicker.getDocumentAsync({
      type: ACCEPTED_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    })
    if (result.canceled || !result.assets?.[0]) return

    const asset = result.assets[0]
    const picked: PickedFile = {
      uri: asset.uri,
      name: asset.name,
      /* Android sometimes reports no mimeType for a document picked from a
         third-party provider. Falling back on the extension keeps a valid
         PDF from being rejected for the picker's shortcoming. */
      mimeType: asset.mimeType ?? (asset.name.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      size: asset.size ?? 0,
    }

    const reason = rejectionReason(picked)
    if (reason) {
      setPickError(reason)
      return
    }
    setFile(picked)
  }

  const history = data ?? []
  const latest = history[0]
  const uploading = scan.isPending

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: space.lg,
            paddingTop: insets.top + space.md,
            gap: space.md,
          }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={colors.accent}
            />
          }
        >
          <Txt variant="display">Resume</Txt>

          {/* ── Scan ─────────────────────────────────────────────────── */}
          <Card style={{ gap: space.md }}>
            <Txt variant="section">Scan a CV</Txt>

            <Button variant="quiet" onPress={() => void pick()} disabled={uploading}>
              {file ? 'Choose a different file' : 'Choose a PDF or Word file'}
            </Button>

            {file && (
              <View
                style={{
                  backgroundColor: colors.canvas,
                  borderRadius: radius.md,
                  padding: space.md,
                  gap: 2,
                }}
              >
                <Txt variant="bodySm" numberOfLines={1}>
                  {file.name}
                </Txt>
                <Txt variant="micro" color="inkFaint">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </Txt>
              </View>
            )}

            {pickError && (
              <Txt variant="bodySm" color="danger">
                {pickError}
              </Txt>
            )}

            <Field
              label="Job description"
              value={jobDescription}
              onChangeText={setJobDescription}
              multiline
              numberOfLines={4}
              placeholder="Paste the posting you are targeting"
              editable={!uploading}
              hint="The score is against this posting. Without it there is nothing to score."
              style={{ minHeight: 96, paddingTop: space.md, textAlignVertical: 'top' }}
            />

            {uploading && (
              <View style={{ gap: space.sm }}>
                <View
                  style={{
                    height: 5,
                    borderRadius: radius.pill,
                    backgroundColor: colors.line,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      /* An indeterminate bar sits at a third rather than
                         pretending to a number the platform did not give us. */
                      width: `${progress?.percent ?? 33}%`,
                      height: '100%',
                      backgroundColor: colors.accent,
                      borderRadius: radius.pill,
                    }}
                  />
                </View>
                <Txt variant="micro" color="inkFaint">
                  {progress?.percent != null && progress.percent < 100
                    ? `Uploading — ${progress.percent}%`
                    : 'Scanning. This takes a few seconds.'}
                </Txt>
              </View>
            )}

            {scan.isError && (
              <Txt variant="bodySm" color="danger">
                {scan.error instanceof ApiError ? scan.error.message : 'That scan did not finish.'}
              </Txt>
            )}

            <Button
              loading={uploading}
              disabled={!file || jobDescription.trim().length < 40}
              onPress={() => scan.mutate()}
            >
              {uploading ? 'Scanning' : 'Score my CV'}
            </Button>

            {!uploading && file && jobDescription.trim().length < 40 && (
              <Txt variant="micro" color="inkFaint">
                Paste a bit more of the posting — a line or two is not enough to score against.
              </Txt>
            )}
          </Card>

          {/* ── Latest ───────────────────────────────────────────────── */}
          {isLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: space.xl }} />
          ) : latest ? (
            <>
              <Card
                elevated
                style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}
              >
                <Txt variant="micro" color="inkFaint">
                  LATEST ATS SCORE
                </Txt>
                <Txt style={{ fontSize: 52, lineHeight: 56, fontWeight: '600', color: colors.ink }}>
                  {Math.round(latest.ats_score)}
                </Txt>
                <View
                  style={{
                    paddingHorizontal: space.lg,
                    paddingVertical: 5,
                    borderRadius: radius.pill,
                    backgroundColor: colors[`${band(latest.ats_score).tone}Tint`],
                  }}
                >
                  <Txt variant="micro" color={band(latest.ats_score).tone}>
                    {band(latest.ats_score).label.toUpperCase()}
                  </Txt>
                </View>
                <Txt variant="bodySm" color="inkMuted" numberOfLines={1}>
                  {latest.resume_filename}
                </Txt>
              </Card>

              {history.length > 1 && (
                <>
                  <Txt variant="section" style={{ marginTop: space.sm }}>
                    Earlier scans
                  </Txt>
                  {history.slice(1).map((item) => (
                    <Card key={item.id} style={[styles.row, { justifyContent: 'space-between' }]}>
                      <View style={{ flex: 1, paddingRight: space.md }}>
                        <Txt variant="bodySm" numberOfLines={1}>
                          {item.resume_filename}
                        </Txt>
                        <Txt variant="micro" color="inkFaint">
                          {new Date(item.created_at).toLocaleDateString()}
                        </Txt>
                      </View>
                      <Txt variant="section">{Math.round(item.ats_score)}</Txt>
                    </Card>
                  ))}
                </>
              )}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
