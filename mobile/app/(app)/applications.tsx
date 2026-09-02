import { useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Screen, Card, Txt, Chip, styles } from '@/components/ui'
import { api } from '@/lib/api'
import { useTheme, space, radius } from '@/theme'

/**
 * The pipeline, grouped the same four ways the web board groups it —
 * Wishlist, Applied, Interviewing, Offered — over the same twelve backend
 * stages. That grouping is duplicated here rather than imported because the
 * two apps do not share a package; if it changes on the web it changes here,
 * and the four column ids are the contract.
 *
 * A phone gets a filter rather than four side-by-side columns. Columns need
 * horizontal space to compare; a filtered vertical list is what a thumb can
 * actually work with.
 */

const GROUPS = [
  { id: 'wishlist', label: 'Wishlist', members: ['saved'] },
  { id: 'applied', label: 'Applied', members: ['applied', 'recruiter_contacted'] },
  {
    id: 'interviewing',
    label: 'Interviewing',
    members: [
      'recruiter_screening',
      'online_assessment',
      'technical_interview',
      'manager_interview',
      'final_interview',
    ],
  },
  { id: 'offered', label: 'Offered', members: ['offer', 'accepted'] },
] as const

const STAGE_LABELS: Record<string, string> = {
  saved: 'Saved',
  applied: 'Applied',
  recruiter_contacted: 'Recruiter Contacted',
  recruiter_screening: 'Recruiter Screening',
  online_assessment: 'Online Assessment',
  technical_interview: 'Technical Interview',
  manager_interview: 'Manager Interview',
  final_interview: 'Final Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

interface Application {
  id: number
  job_title: string
  company: string
  status: string
  applied_at: string | null
}

export default function Applications() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const [group, setGroup] = useState<string>('all')

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['applications'],
    queryFn: async () =>
      (await api.get<{ pipeline: Record<string, Application[]> }>('/applications')).data,
  })

  const rows = useMemo(() => {
    const pipeline = data?.pipeline ?? {}
    const stages =
      group === 'all'
        ? Object.keys(pipeline)
        : (GROUPS.find((g) => g.id === group)?.members ?? [])
    return stages.flatMap((stage) => pipeline[stage] ?? [])
  }, [data, group])

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
        <Txt variant="display">Applications</Txt>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={[styles.row, { gap: space.sm, paddingVertical: space.sm }]}>
            <Chip label="All" selected={group === 'all'} onPress={() => setGroup('all')} />
            {GROUPS.map((g) => (
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
        ) : rows.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xxl }}>
            <Txt variant="section">Nothing here yet</Txt>
            <Txt variant="bodySm" color="inkMuted" style={{ marginTop: space.sm }}>
              Applications you save or send will appear here.
            </Txt>
          </Card>
        ) : (
          rows.map((row) => (
            <Card key={row.id} style={{ gap: space.xs }}>
              <Txt variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                {row.job_title}
              </Txt>
              <Txt variant="bodySm" color="inkMuted" numberOfLines={1}>
                {row.company}
              </Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs }}>
                <View
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: 4,
                    borderRadius: radius.pill,
                    backgroundColor: colors.accentTint,
                  }}
                >
                  {/* The precise stage, not the group. Grouping is for
                      filtering; a card that said "Interviewing" when the
                      real answer is "Final Interview" would be hiding the
                      only part that is news. */}
                  <Txt variant="micro" color="accentText">
                    {STAGE_LABELS[row.status] ?? row.status}
                  </Txt>
                </View>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  )
}
