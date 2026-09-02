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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
})

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200],
    lightColor: '#6D4AFF',
  })
}

export type PermissionOutcome = 'granted' | 'denied' | 'unsupported'

/**
 * Asks for permission and registers the resulting token.
 *
 * Returns 'unsupported' on a simulator rather than throwing: push tokens
 * need real hardware, and a development build should not fail because it is
 * running in an emulator.
 */
export async function registerForPush(): Promise<PermissionOutcome> {
  if (!Device.isDevice) return 'unsupported'

  await ensureAndroidChannel()

  const existing = await Notifications.getPermissionsAsync()
  let status = existing.status
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status
  }
  if (status !== 'granted') return 'denied'

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data

  await api.post('/notifications/devices', {
    expo_push_token: token,
    platform: Platform.OS,
  })

  return 'granted'
}

/** Called on sign-out, so the next user on this device is not sent their mail. */
export async function unregisterPush(): Promise<void> {
  if (!Device.isDevice) return
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
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
