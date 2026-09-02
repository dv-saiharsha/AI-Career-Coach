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

export interface StoredSession {
  accessToken: string
  refreshToken: string
  /** Unix seconds. */
  expiresAt: number
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), OPTIONS)
}

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, OPTIONS)
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
  await SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS)
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
  return (await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY, OPTIONS)) === 'on'
}

export async function setBiometricLock(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(BIOMETRIC_PREF_KEY, 'on', OPTIONS)
  else await SecureStore.deleteItemAsync(BIOMETRIC_PREF_KEY, OPTIONS)
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
