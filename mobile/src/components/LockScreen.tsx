import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Screen, Txt, Button, styles } from './ui'
import { useAuth } from '@/lib/auth'
import { space } from '@/theme'

/**
 * Shown when the app returns from a long absence with biometric lock on.
 *
 * It prompts once automatically, because making someone tap a button to get
 * the prompt they expected is a wasted step. If they dismiss it, the button
 * is there — a failed Face ID read in bad light must not strand anyone
 * outside their own applications.
 */
export function LockScreen() {
  const { unlock, signOut } = useAuth()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void unlock().then((ok) => setFailed(!ok))
    // Deliberately once, on mount. Re-prompting on every render would loop.
  }, [unlock])

  return (
    <Screen>
      <View style={[styles.centre, { gap: space.lg }]}>
        <Txt variant="title">ApplyCenter is locked</Txt>
        <Txt variant="body" color="inkMuted" style={{ textAlign: 'center' }}>
          {failed
            ? 'That did not unlock. Try again, or sign out and use your password.'
            : 'Unlock to pick up where you left off.'}
        </Txt>
        <Button onPress={() => void unlock().then((ok) => setFailed(!ok))} style={{ minWidth: 200 }}>
          Unlock
        </Button>
        <Button variant="ghost" onPress={() => void signOut()}>
          Sign out instead
        </Button>
      </View>
    </Screen>
  )
}
