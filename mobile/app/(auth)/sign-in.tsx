import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { Link } from 'expo-router'
import { Screen, Card, Txt, Button, Field } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { space } from '@/theme'

/**
 * Sign in.
 *
 * No split panel. The web has one because a desktop viewport has room the
 * form does not need; a phone does not, and the decision recorded there —
 * that a marketing panel stacked above a form is something to scroll past
 * rather than read — applies here by construction.
 */
export default function SignIn() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(null)
    if (!email.includes('@')) return setError('That email address is missing an @.')
    if (!password) return setError('Enter your password to continue.')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <Txt variant="display">Welcome back</Txt>
          <Txt variant="body" color="inkMuted" style={{ marginTop: space.sm }}>
            Sign in to pick up where you left off.
          </Txt>

          <Card style={{ marginTop: space.xl, gap: space.lg }}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              returnKeyType="next"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              placeholder="Your password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              error={error}
            />
            <Button loading={busy} onPress={() => void submit()}>
              Sign in
            </Button>
          </Card>

          <View style={{ marginTop: space.xl, alignItems: 'center' }}>
            <Link href="/(auth)/sign-up">
              <Txt variant="body" color="accentText">
                New here? Create an account
              </Txt>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
