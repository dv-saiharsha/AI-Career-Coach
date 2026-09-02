import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { api } from './api'

/**
 * Push notifications: permission, token registration, and what a tap does.
 *
 * The backend already decides *what* to notify about — see
 * backend/app/modules/notifications, which dedupes by key and window so a
 * daily sweep does not re-raise the same reminder. This file is only the
 * device end of that: get a token, hand it to the server, and route a tap.
 *
 * Three things worth stating because they are easy to get wrong:
 *
 *   Permission is not requested on launch. A prompt before someone knows
 *   what the app does is the fastest way to a permanent denial, and iOS only
 *   gives you one. It is requested from Settings, or after the first event
 *   worth being told about.
 *
 *   A token is per-install, not per-user. Signing out unregisters it, or the
 *   next person to sign in on that device inherits the previous user's
 *   notifications.
 *
 *   Android needs a channel before anything will show. Created at startup,
 *   because a channel registered after the first notification arrives is a
 *   notification nobody sees.
 */

/**
 * expo-notifications has no web implementation.
 *
 * Not "degraded on web" — absent. Every call goes through to a native module
 * that does not exist there and throws synchronously, and a throw inside the
 * routing effect unmounts the tree, so the whole app dies on a blank screen
 * with a stack trace about a linking problem that isn't one.
 *
 * `npx expo start` offers web alongside iOS and Android, so this path gets
 * taken by anyone pressing `w` to look at the app quickly. Every entry point
 * below returns instead of calling.
 */
const PUSH_SUPPORTED = Platform.OS !== 'web'

if (PUSH_SUPPORTED) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  })
}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200],
    lightColor: '#FFFFFF',
  })
}

export type PermissionOutcome = 'granted' | 'denied' | 'unsupported'

/**
 * The EAS project id, which getExpoPushTokenAsync requires in any standalone
 * build. Expo Go can infer it; a compiled binary cannot, and without it the
 * call throws at runtime on the first registration — in production, on a real
 * user's phone, having passed every check on the way there.
 *
 * app.config.ts puts it on `extra` from the environment. `Constants.easConfig`
 * is where EAS itself writes it during a cloud build. Note that a bare
 * `process.env.EAS_PROJECT_ID` is NOT a usable fallback: only EXPO_PUBLIC_
 * variables are inlined into the bundle, so an unprefixed one is undefined at
 * runtime no matter what the build environment held.
 */
function easProjectId(): string | undefined {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId
  const fromEas = Constants.easConfig?.projectId
  const id = (fromConfig ?? fromEas ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID) as
    | string
    | undefined

  if (!id && !__DEV__) {
    console.warn(
      'No EAS project id. Push registration will fail in this build — set ' +
        'EAS_PROJECT_ID before building, see mobile/.env.example.',
    )
  }
  return id
}

/**
 * Asks for permission and registers the resulting token.
 *
 * Returns 'unsupported' on a simulator rather than throwing: push tokens
 * need real hardware, and a development build should not fail because it is
 * running in an emulator.
 */
export async function registerForPush(): Promise<PermissionOutcome> {
  // Web first: expo-device reports isDevice true in a browser, so the
  // hardware check below does not cover it.
  if (!PUSH_SUPPORTED) return 'unsupported'
  if (!Device.isDevice) return 'unsupported'

  await ensureAndroidChannel()

  const existing = await Notifications.getPermissionsAsync()
  let status = existing.status
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status
  }
  if (status !== 'granted') return 'denied'

  const token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() })).data

  await api.post('/notifications/devices', {
    expo_push_token: token,
    platform: Platform.OS,
  })

  return 'granted'
}

/** Called on sign-out, so the next user on this device is not sent their mail. */
export async function unregisterPush(): Promise<void> {
  if (!PUSH_SUPPORTED) return
  if (!Device.isDevice) return
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() })).data
    await api.delete(`/notifications/devices/${encodeURIComponent(token)}`)
  } catch {
    /* Best effort. A device that cannot reach the server on sign-out is not
       a reason to block the sign-out — the server also drops tokens that
       start failing delivery. */
  }
}

/**
 * Routes a notification tap.
 *
 * The backend already puts an `href` on every notification for the web; the
 * same value is reused here rather than inventing a second routing scheme,
 * since the mobile routes are named to match.
 */
export function useNotificationRouting() {
  const responded = useRef(false)

  useEffect(() => {
    if (!PUSH_SUPPORTED) return

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const href = response.notification.request.content.data?.href
      if (typeof href === 'string' && href.startsWith('/')) {
        router.push(href as never)
      }
    })

    /* A tap on a notification while the app was killed delivers through this
       instead of the listener, and only once. */
    if (!responded.current) {
      responded.current = true
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        const href = response?.notification.request.content.data?.href
        if (typeof href === 'string' && href.startsWith('/')) {
          router.push(href as never)
        }
      })
    }

    return () => sub.remove()
  }, [])
}
