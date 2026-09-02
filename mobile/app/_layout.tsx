import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, useTheme } from '@/theme'
import { AuthProvider, useAuth } from '@/lib/auth'
import { useNotificationRouting, ensureAndroidChannel } from '@/lib/notifications'
import { LockScreen } from '@/components/LockScreen'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      /* A phone changes network constantly. Refetching when it comes back is
         the behaviour people expect from an app, unlike a browser tab. */
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * The gate. Everything under (app) requires a session; everything under
 * (auth) requires the absence of one, so a signed-in user reopening the app
 * never lands on a sign-in form.
 *
 * Redirecting from an effect rather than rendering a <Redirect> keeps the
 * navigator from mounting a screen it is about to replace, which on a device
 * is a visible flash rather than a wasted render.
 */
function Gate() {
  const { session, ready, locked } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useNotificationRouting()

  useEffect(() => {
    void ensureAndroidChannel()
  }, [])

  useEffect(() => {
    if (!ready) return
    const inAuthGroup = segments[0] === '(auth)'
    if (!session && !inAuthGroup) router.replace('/(auth)/sign-in')
    else if (session && inAuthGroup) router.replace('/(app)/jobs')
  }, [ready, session, segments, router])

  if (locked) return <LockScreen />

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  )
}

function Themed() {
  const { scheme, colors } = useTheme()
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} backgroundColor={colors.canvas} />
      <Gate />
    </>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Themed />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
