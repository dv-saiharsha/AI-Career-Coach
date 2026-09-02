import { useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { Link } from 'expo-router'
import { Screen, Card, Txt, Button, Field } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { GoogleButton } from '@/components/GoogleButton'
import { useTheme, space, radius } from '@/theme'

/* Four checks, four bars — the same criteria the web register page uses, so
   a password accepted on one is accepted on the other. The word matters more
   than the colour: it is the part that works without colour vision. */
const LEVELS = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'] as const

function assess(value: string) {
  const checks = [
    { ok: value.length >= 8, want: 'at least 8 characters' },
    { ok: /[A-Z]/.test(value), want: 'a capital letter' },
    { ok: /[0-9]/.test(value), want: 'a number' },
    { ok: /[^A-Za-z0-9]/.test(value), want: 'a symbol' },
  ]
  return {
    score: checks.filter((c) => c.ok).length,
    missing: checks.filter((c) => !c.ok).map((c) => c.want),
  }
}

export default function SignUp() {
  const { signUp } = useAuth()
  const { colors } = useTheme()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const strength = useMemo(() => assess(password), [password])
  const barColor = [colors.danger, colors.danger, colors.warning, colors.accent, colors.success][
    strength.score
  ]

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('We need a name to put on your applications.')
    if (!email.includes('@')) return setError('That email address is missing an @.')
    if (strength.score < 2) {
      return setError(`That password is too easy to guess. It still needs ${strength.missing.join(', ')}.`)
    }
    setBusy(true)
    try {
      await signUp(email.trim(), password, name.trim())
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
          <Txt variant="display">Check your email</Txt>
          <Txt variant="body" color="inkMuted">
            We sent a confirmation link to {email}. Open it on this device and you will land
            straight in.
          </Txt>
          <Link href="/(auth)/sign-in" style={{ marginTop: space.lg }}>
            <Txt variant="body" color="accentText">
              Back to sign in
            </Txt>
          </Link>
        </View>
      </Screen>
    )
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
          <Txt variant="display">Create your account</Txt>
          <Txt variant="body" color="inkMuted" style={{ marginTop: space.sm }}>
            Free, and it stays free. No card needed.
          </Txt>

          <Card style={{ marginTop: space.xl, gap: space.lg }}>
            <Field
              label="Full name"
              value={name}
              onChangeText={setName}
              autoComplete="name"
              placeholder="Priya Raman"
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              placeholder="At least 8 characters"
              hint={
                password.length === 0
                  ? 'Eight characters is the floor, not the goal.'
                  : strength.missing.length
                    ? `${LEVELS[strength.score]} — still needs ${strength.missing.join(', ')}.`
                    : 'Strong. That will hold up.'
              }
              error={error}
            />

            {password.length > 0 && (
              <View
                accessible
                accessibilityLabel={`Password strength: ${LEVELS[strength.score]}`}
                style={{ flexDirection: 'row', gap: space.xs, marginTop: -space.sm }}
              >
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: radius.pill,
                      backgroundColor: i < strength.score ? barColor : colors.line,
                    }}
                  />
                ))}
              </View>
            )}

            <Button loading={busy} onPress={() => void submit()}>
              Create account
            </Button>
          </Card>

          <View style={{ marginTop: space.lg }}>
            <GoogleButton />
          </View>

          <View style={{ marginTop: space.xl, alignItems: 'center' }}>
            <Link href="/(auth)/sign-in">
              <Txt variant="body" color="accentText">
                Already have an account? Sign in
              </Txt>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
