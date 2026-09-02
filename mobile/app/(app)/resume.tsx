import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Screen, Card, Txt } from '@/components/ui'
import { api } from '@/lib/api'
import { useTheme, space, radius } from '@/theme'

/**
 * The latest CV score and what moved it.
 *
 * Read-only on purpose for this first build. Uploading a CV from a phone is
 * a real feature and a separate one — a document picker, a multipart upload
 * with progress, and the several-second scan narration — and shipping a
 * half-working upload is worse than shipping none.
 */

interface HistoryItem {
  id: number
  resume_filename: string
  ats_score: number
  created_at: string
}

function band(score: number): { label: string; key: 'success' | 'warning' | 'danger' } {
  if (score >= 75) return { label: 'Strong', key: 'success' }
  if (score >= 45) return { label: 'Partial', key: 'warning' }
  return { label: 'Needs work', key: 'danger' }
}

export default function Resume() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['resume', 'history'],
    queryFn: async () => (await api.get<HistoryItem[]>('/resume/history')).data,
  })

  const history = data ?? []
  const latest = history[0]

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.md, gap: space.md }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.accent}
          />
        }
      >
        <Txt variant="display">Resume</Txt>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: space.xxl }} />
        ) : !latest ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xxl }}>
            <Txt variant="section">No scans yet</Txt>
            <Txt
              variant="bodySm"
              color="inkMuted"
              style={{ textAlign: 'center', marginTop: space.sm }}
            >
              Upload a CV on the web and its score will show up here.
            </Txt>
          </Card>
        ) : (
          <>
            <Card elevated style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
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
                  backgroundColor: colors[`${band(latest.ats_score).key}Tint`],
                }}
              >
                <Txt variant="micro" color={band(latest.ats_score).key === 'danger' ? 'danger' : 'success'}>
                  {band(latest.ats_score).label.toUpperCase()}
                </Txt>
              </View>
              <Txt variant="bodySm" color="inkMuted" numberOfLines={1}>
                {latest.resume_filename}
              </Txt>
            </Card>

            {history.length > 1 && (
              <>
                <Txt variant="section" style={{ marginTop: space.md }}>
                  Earlier scans
                </Txt>
                {history.slice(1).map((item) => (
                  <Card key={item.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
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
        )}
      </ScrollView>
    </Screen>
  )
}
