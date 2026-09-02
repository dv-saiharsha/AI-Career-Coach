import { useMemo, useState } from 'react'
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Screen, Card, Txt, Chip, styles } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import {
  CLOSED_STAGES,
  STAGE_GROUPS,
  STAGE_LABELS,
  groupForStage,
  stageForGroup,
  type ApplicationStatus,
  type GroupId,
} from '@/lib/stages'
import { useTheme, space, radius } from '@/theme'

interface Application {
  id: number
  job_title: string
  company: string
  status: ApplicationStatus
  applied_at: string | null
}

interface Pipeline {
  pipeline: Record<ApplicationStatus, Application[]>
  total: number
}

const PIPELINE_KEY = ['applications', 'pipeline'] as const

/**
 * The pipeline, with stage movement.
 *
 * A phone gets a filtered vertical list rather than four columns side by
 * side. Columns exist to be compared across; a thumb works down one list.
 *
 * Moving a card is an action sheet rather than a swipe. A swipe can only
 * express two destinations, and there are five here — four groups plus
 * closing it — so a swipe would have to mean "next stage", which is exactly
 * the gesture that fires by accident in a scrolling list and silently
 * advances someone's job application.
 */
export default function Applications() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const [group, setGroup] = useState<GroupId | 'all'>('all')

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: PIPELINE_KEY,
    queryFn: async () => (await api.get<Pipeline>('/applications/pipeline')).data,
  })

  const move = useMutation({
    mutationFn: ({ id, status }: { id: number; status: ApplicationStatus }) =>
      api.patch(`/applications/${id}/status`, { status }),

    /* Optimistic, because the card must move under the thumb that moved it.
       Waiting for a round trip on a phone network means a card that sits
       still for a second and then jumps, which reads as the tap not having
       registered — so people tap again. */
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: PIPELINE_KEY })
      const previous = queryClient.getQueryData<Pipeline>(PIPELINE_KEY)

      queryClient.setQueryData<Pipeline>(PIPELINE_KEY, (current) => {
        if (!current) return current
        const next = { ...current.pipeline }
        let moved: Application | undefined

        for (const stage of Object.keys(next) as ApplicationStatus[]) {
          const found = next[stage]?.find((a) => a.id === id)
          if (found) {
            moved = { ...found, status }
            next[stage] = next[stage].filter((a) => a.id !== id)
          }
        }
        if (moved) next[status] = [moved, ...(next[status] ?? [])]
        return { ...current, pipeline: next }
      })

      return { previous }
    },

    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(PIPELINE_KEY, context.previous)
      /* Say it plainly. A card that slides back with no explanation leaves
         someone unsure whether the move saved. */
      Alert.alert(
        "Couldn't move that",
        err instanceof ApiError ? err.message : 'The card has been put back. Try again.',
      )
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_KEY })
    },
  })

  const rows = useMemo(() => {
    const pipeline = data?.pipeline ?? ({} as Pipeline['pipeline'])
    const stages =
      group === 'all'
        ? (Object.keys(pipeline) as ApplicationStatus[])
        : (STAGE_GROUPS.find((g) => g.id === group)?.members ?? [])
    return stages.flatMap((stage) => pipeline[stage] ?? [])
  }, [data, group])

  function promptMove(application: Application) {
    const destinations = STAGE_GROUPS.filter(
      (g) => groupForStage(application.status)?.id !== g.id,
    )
    const labels = [
      ...destinations.map((g) => `Move to ${g.label}`),
      ...CLOSED_STAGES.map((s) => `Mark ${STAGE_LABELS[s]}`),
    ]

    const apply = (index: number) => {
      if (index < destinations.length) {
        const next = stageForGroup(destinations[index].id, application.status)
        if (next !== application.status) move.mutate({ id: application.id, status: next })
        return
      }
      const closed = CLOSED_STAGES[index - destinations.length]
      if (closed) move.mutate({ id: application.id, status: closed })
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: application.job_title,
          message: `Currently ${STAGE_LABELS[application.status]}`,
          options: [...labels, 'Cancel'],
          cancelButtonIndex: labels.length,
          destructiveButtonIndex: labels.length - 1,
        },
        (index) => {
          if (index < labels.length) apply(index)
        },
      )
      return
    }

    /* Android has no system action sheet, and Alert takes at most three
       buttons — so the destinations become an alert chain rather than a
       silently truncated list. */
    Alert.alert(
      application.job_title,
      `Currently ${STAGE_LABELS[application.status]}. Move it to:`,
      [
        ...labels.map((label, index) => ({
          text: label,
          style: (index === labels.length - 1 ? 'destructive' : 'default') as 'default' | 'destructive',
          onPress: () => apply(index),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
      { cancelable: true },
    )
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          gap: space.md,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.accent}
          />
        }
      >
        <Txt variant="display">Applications</Txt>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={[styles.row, { gap: space.sm, paddingVertical: space.sm }]}>
            <Chip label="All" selected={group === 'all'} onPress={() => setGroup('all')} />
            {STAGE_GROUPS.map((g) => (
              <Chip
                key={g.id}
                label={g.label}
                selected={group === g.id}
                onPress={() => setGroup(g.id)}
              />
            ))}
          </View>
        </ScrollView>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: space.xxl }} />
        ) : isError ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xxl }}>
            <Txt variant="section">Couldn&apos;t load your pipeline</Txt>
            <Txt
              variant="bodySm"
              color="inkMuted"
              style={{ textAlign: 'center', marginTop: space.sm }}
            >
              {error instanceof ApiError ? error.message : 'Pull down to try again.'}
            </Txt>
          </Card>
        ) : rows.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xxl }}>
            <Txt variant="section">Nothing here yet</Txt>
            <Txt variant="bodySm" color="inkMuted" style={{ marginTop: space.sm }}>
              {group === 'all'
                ? 'Applications you save or send will appear here.'
                : 'Nothing at this stage right now.'}
            </Txt>
          </Card>
        ) : (
          rows.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => promptMove(row)}
              accessibilityRole="button"
              accessibilityLabel={`${row.job_title} at ${row.company}, ${STAGE_LABELS[row.status]}. Tap to move.`}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Card style={{ gap: space.xs }}>
                <Txt variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                  {row.job_title}
                </Txt>
                <Txt variant="bodySm" color="inkMuted" numberOfLines={1}>
                  {row.company}
                </Txt>
                <View style={[styles.row, { marginTop: space.xs }]}>
                  <View
                    style={{
                      paddingHorizontal: space.md,
                      paddingVertical: 4,
                      borderRadius: radius.pill,
                      backgroundColor: colors.accentTint,
                    }}
                  >
                    {/* The precise stage, not the group. A card that said
                        "Interviewing" when the answer is "Final Interview"
                        would be hiding the only part that is news. */}
                    <Txt variant="micro" color="accentText">
                      {STAGE_LABELS[row.status]}
                    </Txt>
                  </View>
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  )
}
