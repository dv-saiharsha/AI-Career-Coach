import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { useTheme, HIT_SLOP_MIN } from '@/theme'

/**
 * Five tabs, matching what someone opens a phone for. The web has sixteen
 * signed-in routes; most of them — the tailor workspace, the reports view,
 * the analytics charts — are desktop-shaped work that would be worse on a
 * phone, not better for being present.
 *
 * Labels are glyphs rather than an icon font: one dependency fewer, and the
 * tab bar is the last place worth loading a library for.
 */
const GLYPH = { dashboard: '◉', jobs: '⌗', applications: '▤', resume: '◈', settings: '⚙' } as const

export default function AppLayout() {
  const { colors } = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: {
          backgroundColor: colors.canvasRaise,
          borderTopColor: colors.line,
          height: HIT_SLOP_MIN + 26,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{GLYPH.dashboard}</Text>,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{GLYPH.jobs}</Text>,
        }}
      />
      <Tabs.Screen
        name="applications"
        options={{
          title: 'Applications',
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>{GLYPH.applications}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="resume"
        options={{
          title: 'Resume',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{GLYPH.resume}</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{GLYPH.settings}</Text>,
        }}
      />
    </Tabs>
  )
}
