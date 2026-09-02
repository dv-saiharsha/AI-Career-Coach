import type { ExpoConfig } from 'expo/config'

/**
 * A config file rather than app.json, because app.json is static and the
 * EAS project id has to come from the environment.
 *
 * That id is what getExpoPushTokenAsync needs in any standalone build — Expo
 * Go can infer it, a compiled binary cannot, and the failure is a runtime
 * throw on the first push registration rather than a build error. Hard-coding
 * it works right up until the project is rebuilt under a different account.
 */
const projectId = process.env.EAS_PROJECT_ID ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID

const config: ExpoConfig = {
  name: 'ApplyCenter',
  slug: 'applycenter',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'applycenter',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'org.chieac.applycenter',
    infoPlist: {
      NSFaceIDUsageDescription:
        'Unlock ApplyCenter with Face ID instead of retyping your password.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'org.chieac.applycenter',
    adaptiveIcon: { backgroundColor: '#150F2E' },
    edgeToEdgeEnabled: true,
    permissions: ['USE_BIOMETRIC', 'USE_FINGERPRINT', 'POST_NOTIFICATIONS'],
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-local-authentication', { faceIDPermission: 'Unlock ApplyCenter with Face ID.' }],
    ['expo-notifications', { color: '#6D4AFF' }],
  ],

  experiments: { typedRoutes: true },

  extra: {
    /* Read at runtime through Constants.expoConfig.extra. The EXPO_PUBLIC_
       vars are inlined into the bundle directly and do not need to be here;
       this is only for values that are not, which is the project id. */
    eas: projectId ? { projectId } : undefined,
  },
}

export default config
