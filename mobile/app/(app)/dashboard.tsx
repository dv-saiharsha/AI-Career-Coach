import { useCallback } from 'react'
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'

import { Screen, Card, Txt, Button, styles } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useTheme, space, radius, HIT_SLOP_MIN } from '@/theme'

/**
 * The landing screen: where you are, and the one or two things worth doing now.
 *
 * Everything here is read from /dashboard/overview, which the web dashboard
 * already uses — one endpoint, one round trip, no per-card fetches. A phone
 * on a train pays for every request separately, and four parallel calls that
 * each might fail is four partial-failure states to design instead of one.
 *
 * Nothing on this screen invents a number. Where the backend returns null —
 * no scan yet, no scored applications — the card says what is missing and how
 * to fix it, rather than rendering a zero that reads like a bad result.
 */

interface FreshJob {
  id: string
  title: string
  company: string
  location: string
  work_mode: string
  posted_label: string
  /** As the employer wrote it. Most postings do not state one. */
  salary_range?: string | null
  /** 'sponsors' / 'no' / null — the product's audience filters on this. */
  h1b_sponsorship?: string | null
  apply_url: string
}

interface Overview {
  metrics: {
    total_applied: number
    by_stage: Record<string, number>
    average_match_score: number | null
    scored_applications: number
    total_applications: number
  }
  fresh_jobs: FreshJob[]
  fresh_window: string
  latest_ats_score: number | null
  scored_against: string | null
}

/** Emerald 75+, amber 60-74, crimson below — the web's thresholds. */
function scoreColor(score: number | null, colors: ReturnType<typeof useTheme>['colors']): string {
  if (score === null) return colors.inkFaint
  if (score >= 75) return colors.success
  if (score >= 60) return colors.warning
  return colors.danger
}

export default function Dashboard() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useAuth()

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => (await api.get<Overview>('/dashboard/overview')).data,
  })

  const openJob = useCallback((url: string) => {
    if (url) Linking.openURL(url).catch(() => {})
  }, [])

  // Supabase carries the display name in user_metadata; the first word of it
  // is what a greeting wants. Falls back to nothing rather than to "there" —
  // "Welcome back" alone reads better than a placeholder name.
  const fullName =
    (session?.user?.user_metadata?.full_name as string | undefined) ??
    (session?.user?.user_metadata?.name as string | undefined) ??
    ''
  const firstName = fullName.trim().split(' ')[0] ?? ''

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.centre}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    )
  }

  const metrics = data?.metrics
  const atsScore = data?.latest_ats_score ?? null

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.xl,
          gap: space.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.accent}
          />
        }
      >
        <View style={{ gap: space.xs }}>
          <Txt variant="title">{firstName ? `Welcome back, ${firstName}` : 'Welcome back'}</Txt>
          {data?.scored_against ? (
            <Txt variant="bodySm" color="inkMuted">
              Last scored against {data.scored_against}
            </Txt>
          ) : null}
        </View>

        {isError ? (
          <Card>
            <Txt variant="body" color="danger">
              Couldn&apos;t load your dashboard.
            </Txt>
            <Txt variant="bodySm" color="inkMuted" style={{ marginTop: space.xs }}>
              Pull down to try again.
            </Txt>
          </Card>
        ) : null}

        {/* ATS health + pipeline. One card because they are one answer to
            "where do I stand" — splitting them puts two large numbers side by
            side competing for the same glance. */}
        <Card elevated>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="label" color="inkSubtle">
              ATS match health
            </Txt>
            <Txt
              variant="display"
              style={{ color: scoreColor(atsScore, colors), fontVariant: ['tabular-nums'] }}
            >
              {atsScore === null ? '—' : `${Math.round(atsScore)}%`}
            </Txt>
          </View>

          <View
            style={{
              height: 1,
              backgroundColor: colors.line,
              marginVertical: space.md,
            }}
          />

          {atsScore === null ? (
            <Txt variant="bodySm" color="inkMuted">
              No resume scanned yet. Upload one to get a score.
            </Txt>
          ) : (
            <Txt variant="bodySm" color="inkMuted">
              Active pipeline: {metrics?.total_applied ?? 0}{' '}
              {metrics?.total_applied === 1 ? 'application' : 'applications'}
              {metrics?.average_match_score != null
                ? ` · ${Math.round(metrics.average_match_score)}% average match`
                : ''}
            </Txt>
          )}

          {/* Scored-vs-total, stated only when they differ. A "14 applications"
              figure where only 6 carry a match score is two different numbers
              presented as one. */}
          {metrics &&
          metrics.scored_applications > 0 &&
          metrics.scored_applications < metrics.total_applications ? (
            <Txt variant="bodySm" color="inkFaint" style={{ marginTop: space.xs }}>
              {metrics.scored_applications} of {metrics.total_applications} scored
            </Txt>
          ) : null}
        </Card>

        <View style={{ gap: space.sm }}>
          <Txt variant="label" color="inkSubtle">
            Quick actions
          </Txt>
          <Button onPress={() => router.push('/(app)/resume')}>Upload CV</Button>
          <Button variant="quiet" onPress={() => router.push('/(app)/applications')}>
            Review pipeline
          </Button>
        </View>

        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Txt variant="label" color="inkSubtle">
              Recent jobs
            </Txt>
            {data?.fresh_window ? (
              <Txt variant="bodySm" color="inkFaint">
                {data.fresh_window}
              </Txt>
            ) : null}
          </View>

          {(data?.fresh_jobs ?? []).length === 0 ? (
            <Card>
              <Txt variant="bodySm" color="inkMuted">
                Nothing new in this window. The feed refreshes as postings arrive.
              </Txt>
            </Card>
          ) : (
            (data?.fresh_jobs ?? []).slice(0, 5).map((job) => (
              <Pressable
                key={job.id}
                accessibilityRole="link"
                accessibilityLabel={`${job.title} at ${job.company}. Opens the posting.`}
                onPress={() => openJob(job.apply_url)}
                style={({ pressed }) => ({
                  backgroundColor: colors.canvasRaise,
                  borderRadius: radius.xl,
                  padding: space.lg,
                  minHeight: HIT_SLOP_MIN,
                  opacity: pressed ? 0.82 : 1,
                  gap: space.xs,
                })}
              >
                <Txt variant="bodySm" color="accentText" numberOfLines={1}>
                  {job.company}
                </Txt>
                <Txt variant="body" numberOfLines={2}>
                  {job.title}
                </Txt>
                <Txt variant="bodySm" color="inkMuted" numberOfLines={1}>
                  {[job.location, job.salary_range, job.posted_label].filter(Boolean).join(' · ')}
                </Txt>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  )
}
