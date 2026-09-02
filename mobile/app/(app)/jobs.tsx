import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Screen, Card, Txt, Chip, Field, styles } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { useTheme, space, radius } from '@/theme'

/**
 * The job feed, as a grid.
 *
 * Two columns rather than a list, which is what the web view collapses to on
 * a narrow viewport. A job card is a company, a title, a location and a match
 * score — four short lines — so a full-width row leaves most of the screen
 * empty and puts four jobs on a phone instead of eight. Scanning a feed is
 * the whole task here.
 *
 * FlatList rather than a ScrollView of cards: the feed is unbounded, and a
 * ScrollView mounts every row whether or not it is on screen.
 */

/**
 * Mirrors JobListingSchema in backend/app/schemas/job.py.
 *
 * camelCase, which is unusual for this API and deliberate there: the job feed
 * is the one payload the web frontend consumes with no mapping layer, so the
 * schema matches its TypeScript interface rather than the Python convention.
 * This file previously declared `work_mode` and every card rendered blank,
 * because the field arriving was `workMode`.
 */
interface Job {
  id: string
  title: string
  company: string
  location: string
  workMode: 'Remote' | 'Hybrid' | 'On-site'
  salaryRange: string
  postedDaysAgo: number
  applyUrl: string
  skills: string[]
  match?: { overallMatch: number | null; band: string | null } | null
}

/**
 * The endpoint returns a feed object, not a bare array.
 *
 * Reading it as an array is what emptied this screen: `data.filter` is
 * undefined on an object, so the list rendered nothing and the error state
 * never fired either, because the request itself had succeeded.
 */
interface JobFeed {
  lastUpdated: string | null
  jobs: Job[]
  refreshing: boolean
}

const MODES = ['All', 'Remote', 'Hybrid', 'On-site'] as const

export default function Jobs() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<(typeof MODES)[number]>('All')

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => (await api.get<JobFeed>('/jobs')).data,
  })

  const jobs = useMemo(() => {
    // `?? []` on the array, not on the feed: a feed that arrives without a
    // jobs key is a shape change, and defaulting the whole object would hide
    // it behind an empty list again.
    const all = data?.jobs ?? []
    const term = search.trim().toLowerCase()
    return all.filter((job) => {
      if (mode !== 'All' && job.workMode.toLowerCase() !== mode.toLowerCase()) return false
      if (!term) return true
      return (
        job.title.toLowerCase().includes(term) ||
        job.company.toLowerCase().includes(term) ||
        job.location.toLowerCase().includes(term) ||
        job.skills.some((skill) => skill.toLowerCase().includes(term))
      )
    })
  }, [data, search, mode])

  return (
    <Screen>
      <FlatList
        data={jobs}
        keyExtractor={(job) => job.id}
        numColumns={2}
        columnWrapperStyle={{ gap: space.md }}
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          gap: space.md,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.md }}>
            <Txt variant="display">Job Market</Txt>
            <Txt variant="bodySm" color="inkMuted">
              Fresh listings matched to the roles you are targeting.
            </Txt>
            <Field
              label="Search"
              value={search}
              onChangeText={setSearch}
              placeholder="Title, company, or skill"
              autoCapitalize="none"
              returnKeyType="search"
            />
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              {MODES.map((m) => (
                <Chip key={m} label={m} selected={mode === m} onPress={() => setMode(m)} />
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centre}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <View style={styles.centre}>
              <Txt variant="section">
                {isError ? "Couldn't load jobs" : 'Nothing matches that yet'}
              </Txt>
              <Txt
                variant="bodySm"
                color="inkMuted"
                style={{ textAlign: 'center', marginTop: space.sm }}
              >
                {isError
                  ? error instanceof ApiError
                    ? error.message
                    : 'Something went wrong.'
                  : search
                    ? 'Try a broader role title.'
                    : 'Pull down to refresh the feed.'}
              </Txt>
            </View>
          )
        }
        renderItem={({ item }) => <JobCard job={item} />}
      />
    </Screen>
  )
}

function JobCard({ job }: { job: Job }) {
  const { colors } = useTheme()
  const score = job.match?.overallMatch

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${job.company}${
        score != null ? `, ${Math.round(score)} percent match` : ''
      }`}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ flex: 1, gap: space.sm, minHeight: 132 }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.sm,
            backgroundColor: colors.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt variant="label" color="accentText">
            {job.company.slice(0, 1).toUpperCase()}
          </Txt>
        </View>

        <Txt variant="bodySm" numberOfLines={2} style={{ fontWeight: '600' }}>
          {job.title}
        </Txt>
        <Txt variant="micro" color="inkMuted" numberOfLines={1}>
          {job.company}
        </Txt>
        <Txt variant="micro" color="inkFaint" numberOfLines={1}>
          {[job.location, job.workMode].filter(Boolean).join(' · ') || '—'}
        </Txt>

        {score != null && (
          <View style={{ marginTop: 'auto', gap: 4 }}>
            <View
              style={{
                height: 4,
                borderRadius: radius.pill,
                backgroundColor: colors.line,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, Math.max(0, score))}%`,
                  height: '100%',
                  borderRadius: radius.pill,
                  /* Signal, not accent. The accent is ink now, and an ink bar
                     on a white card reads as a rule rather than a measurement. */
                  backgroundColor: colors.signal,
                }}
              />
            </View>
            <Txt variant="micro" color="inkFaint">
              {Math.round(score)}% match
            </Txt>
          </View>
        )}
      </Card>
    </Pressable>
  )
}
