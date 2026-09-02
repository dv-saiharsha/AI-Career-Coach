import { useState } from 'react'
import { View } from 'react-native'

import { Button, Txt } from '@/components/ui'
import { signInWithGoogle } from '@/lib/googleAuth'
import { useTheme, space } from '@/theme'

/**
 * "Continue with Google", plus the divider above it.
 *
 * One component used by both sign-in and sign-up, because with Google there
 * is no difference between the two: the first time through creates the
 * account, every time after signs in. Labelling it "Sign up with Google" on
 * one screen and "Sign in with Google" on the other implies a distinction the
 * flow does not have, and sends people who already have an account to the
 * wrong screen looking for the right button.
 *
 * A cancelled sheet sets no error. Dismissing the consent screen is a choice,
 * and reporting "sign-in failed" for it accuses the user of a mistake they
 * did not make.
 *
 * The mark is drawn rather than imported: Google's brand guidelines want
 * their glyph exactly as supplied, and a wrong-coloured approximation is
 * worse than a plain, honest button. A wordmark-free label with the four
 * brand colours in the divider would be cargo-culting; this stays neutral.
 */
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  const { colors } = useTheme()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle()
      /* Nothing to navigate on success: onAuthStateChange in lib/auth.tsx
         sees the new session and the root layout swaps the stack. Pushing a
         route here would race that and land on a screen about to unmount. */
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in with Google.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
        <Txt variant="micro" color="inkFaint">
          OR
        </Txt>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      </View>

      <Button variant="quiet" loading={busy} onPress={() => void run()}>
        {label}
      </Button>

      {error && (
        <Txt variant="bodySm" color="danger" style={{ textAlign: 'center' }}>
          {error}
        </Txt>
      )}
    </View>
  )
}
