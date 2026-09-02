import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'

/**
 * The Supabase client, with the keychain as its storage adapter.
 *
 * supabase-js persists the session through whatever `storage` it is handed;
 * every React Native example hands it AsyncStorage, which is an unencrypted
 * file. This hands it SecureStore instead, so the refresh token sits in
 * Keychain Services or the Android Keystore rather than in plaintext on
 * disk. See lib/secureSession.ts for why that distinction is load-bearing.
 *
 * detectSessionInUrl is off because there is no URL to detect one in — that
 * option exists for the browser's OAuth redirect. On a device the deep link
 * is handled explicitly by the auth callback route.
 */

const extra = Constants.expoConfig?.extra as Record<string, string> | undefined

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? ''
const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  /* Supabase renamed anon -> publishable. Both spellings are read so a
     project created either side of that change works without anyone having
     to know which era it came from. */
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  extra?.supabasePublishableKey ??
  ''

if (__DEV__ && (!SUPABASE_URL || !SUPABASE_KEY)) {
  /* Loud in development, because the failure without it is every request
     returning 401 with nothing explaining why. */
  console.warn(
    'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in mobile/.env — see .env.example.',
  )
}

/** SecureStore, shaped as the storage interface supabase-js expects. */
const keychainStorage = {
  getItem: (key: string) =>
    SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  removeItem: (key: string) =>
    SecureStore.deleteItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: keychainStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
