import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'

/**
 * Where the session actually lives, and the reason this file exists at all.
 *
 * On the web, Supabase keeps the session in localStorage and that is fine —
 * the browser's origin isolation is the boundary. On a phone there is no
 * equivalent: AsyncStorage is an unencrypted SQLite file in the app's
 * sandbox, readable on a rooted or jailbroken device and, on Android, by
 * anything that can reach an unencrypted backup.
 *
 * So the refresh token goes in the platform keychain — Keychain Services on
 * iOS, EncryptedSharedPreferences via the Android Keystore — and is bound to
 * this device with WHEN_UNLOCKED_THIS_DEVICE_ONLY. That last part matters:
 * it keeps the token out of iCloud Keychain and out of device-to-device
 * transfers, so restoring a backup onto a new phone does not silently carry
 * someone's signed-in session with it.
 *
 * Biometric unlock is a second, separate gate on top. It does not protect
 * the token — the keychain does that — it protects the *session* from
 * someone holding an already-unlocked phone.
 */

const SESSION_KEY = 'applycenter.session'
const BIOMETRIC_PREF_KEY = 'applycenter.biometric'

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

/**
 * One storage shim, so the six call sites below do not each need a guard.
 *
 * expo-secure-store's web build is `export default {}` — every function is
 * undefined there, and the first call throws a TypeError during startup.
 * `npx expo start` offers web next to iOS and Android, so that path is one
 * keypress away and takes the whole app down before sign-in.
 *
 * On web this falls through to localStorage, which is the storage a browser
 * actually has. That is a real reduction in protection and it is why web is a
 * preview target here and not a shipping surface: a browser has no Keychain
 * Services and no Android Keystore, so there is nothing stronger to fall back
 * to. On iOS and Android — the platforms this app ships to — the keychain
 * branch is what runs, and WHEN_UNLOCKED_THIS_DEVICE_ONLY still means a
 * restored backup does not carry a signed-in session onto a new phone.
 */
const store = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(key) ?? null
      } catch {
        /* Private browsing and blocked site data both throw here. A missing
           session is the correct answer; a crash is not. */
        return null
      }
    }
    return SecureStore.getItemAsync(key, OPTIONS)
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        /* Nothing to do — the session simply will not survive a reload. */
      }
      return
    }
    await SecureStore.setItemAsync(key, value, OPTIONS)
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.removeItem(key)
      } catch {
        /* Already unreachable; there is nothing left to clear. */
      }
      return
    }
    await SecureStore.deleteItemAsync(key, OPTIONS)
  },
}

export interface StoredSession {
  accessToken: string
  refreshToken: string
  /** Unix seconds. */
  expiresAt: number
}

export async function saveSession(session: StoredSession): Promise<void> {
  await store.set(SESSION_KEY, JSON.stringify(session))
}

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await store.get(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed.accessToken || !parsed.refreshToken) return null
    return parsed
  } catch {
    /* A value that will not parse is a value we cannot use. Clearing it
       rather than throwing means a corrupted entry costs one sign-in, not a
       crash loop on every launch. */
    await clearSession()
    return null
  }
}

export async function clearSession(): Promise<void> {
  await store.remove(SESSION_KEY)
}

/** True when the device can actually do biometrics AND has some enrolled. */
export async function biometricsAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ])
  return hasHardware && isEnrolled
}

export async function isBiometricLockEnabled(): Promise<boolean> {
  return (await store.get(BIOMETRIC_PREF_KEY)) === 'on'
}

export async function setBiometricLock(enabled: boolean): Promise<void> {
  if (enabled) await store.set(BIOMETRIC_PREF_KEY, 'on')
  else await store.remove(BIOMETRIC_PREF_KEY)
}

/**
 * Prompts for Face ID / fingerprint.
 *
 * `disableDeviceFallback` is false on purpose: someone whose face is not
 * recognised in bad light should be able to fall through to their passcode
 * rather than be locked out of their own job applications.
 */
export async function authenticate(reason = 'Unlock ApplyCenter'): Promise<boolean> {
  if (!(await biometricsAvailable())) return true
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: false,
    cancelLabel: 'Use password instead',
  })
  return result.success
}
