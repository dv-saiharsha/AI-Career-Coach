import { useEffect, useState } from 'react'
import { Alert, ScrollView, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Screen, Card, Txt, Button, Chip, styles } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useTheme, space } from '@/theme'
import {
  biometricsAvailable,
  isBiometricLockEnabled,
  setBiometricLock,
  authenticate,
} from '@/lib/secureSession'
import { registerForPush, type PermissionOutcome } from '@/lib/notifications'

/**
 * Settings, and the only screen where the security features are visible.
 *
 * Push permission is requested here rather than on launch. iOS gives one
 * chance at that prompt for the life of the install, and asking before
 * someone knows what the app does is the fastest route to a permanent no.
 */
export default function Settings() {
  const { colors, choice, setChoice } = useTheme()
  const { session, signOut } = useAuth()
  const insets = useSafeAreaInsets()

  const [biometricReady, setBiometricReady] = useState(false)
  const [biometricOn, setBiometricOn] = useState(false)
  const [push, setPush] = useState<PermissionOutcome | 'unknown'>('unknown')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void biometricsAvailable().then(setBiometricReady)
    void isBiometricLockEnabled().then(setBiometricOn)
  }, [])

  async function toggleBiometric(next: boolean) {
    /* Confirm with the sensor before turning it ON. Enabling a lock the
       person cannot then pass would strand them behind it. */
    if (next && !(await authenticate('Confirm it is you'))) return
    await setBiometricLock(next)
    setBiometricOn(next)
  }

  async function enablePush() {
    setBusy(true)
    try {
      const outcome = await registerForPush()
      setPush(outcome)
      if (outcome === 'denied') {
        Alert.alert(
          'Notifications are off',
          'You have turned them off for ApplyCenter. Turn them back on in your device settings.',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          gap: space.md,
        }}
      >
        <Txt variant="display">Settings</Txt>

        <Card style={{ gap: space.xs }}>
          <Txt variant="micro" color="inkFaint">
            SIGNED IN AS
          </Txt>
          <Txt variant="body">{session?.user.email ?? '—'}</Txt>
        </Card>

        <Card style={{ gap: space.md }}>
          <Txt variant="section">Appearance</Txt>
          <View style={[styles.row, { gap: space.sm }]}>
            {(['system', 'light', 'dark'] as const).map((option) => (
              <Chip
                key={option}
                label={option === 'system' ? 'System' : option === 'light' ? 'Light' : 'Dark'}
                selected={choice === option}
                onPress={() => setChoice(option)}
              />
            ))}
          </View>
          <Txt variant="bodySm" color="inkFaint">
            System follows whatever your phone is set to.
          </Txt>
        </Card>

        <Card style={{ gap: space.md }}>
          <Txt variant="section">Security</Txt>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <View style={{ flex: 1, paddingRight: space.md }}>
              <Txt variant="body">Require unlock</Txt>
              <Txt variant="bodySm" color="inkMuted">
                {biometricReady
                  ? 'Ask for Face ID or a fingerprint after a minute away.'
                  : 'No biometrics are set up on this device.'}
              </Txt>
            </View>
            <Switch
              value={biometricOn}
              disabled={!biometricReady}
              onValueChange={(next) => void toggleBiometric(next)}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
          <Txt variant="bodySm" color="inkFaint">
            Your sign-in is stored in the device keychain, not in app storage, and never leaves
            this device.
          </Txt>
        </Card>

        <Card style={{ gap: space.md }}>
          <Txt variant="section">Notifications</Txt>
          <Txt variant="bodySm" color="inkMuted">
            {push === 'granted'
              ? 'On. You will hear about interview stages, follow-ups and score changes.'
              : push === 'denied'
                ? 'Turned off in your device settings.'
                : push === 'unsupported'
                  ? 'Push needs a real device — this is a simulator.'
                  : 'Get told when an application moves or a scan finishes.'}
          </Txt>
          {push !== 'granted' && push !== 'unsupported' && (
            <Button variant="quiet" loading={busy} onPress={() => void enablePush()}>
              Turn on notifications
            </Button>
          )}
        </Card>

        <Button variant="ghost" onPress={() => void signOut()} style={{ marginTop: space.md }}>
          Sign out
        </Button>
      </ScrollView>
    </Screen>
  )
}
