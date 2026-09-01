'use client'

import { createClient } from './supabase/client'

/* The two auth writes, as plain functions rather than context methods.
 *
 * Sign-in and sign-up are the only auth operations the public pages perform,
 * and neither reads the session — they submit credentials and navigate. Going
 * through AuthContext to reach them meant /login and /register mounted a
 * provider whose entire job (subscribing to onAuthStateChange, deriving a
 * display name, holding the user in state) is for screens where somebody is
 * already signed in.
 *
 * AuthProvider calls these too, so there is one implementation, not two. */

export async function signIn(email: string, password: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

export async function signUp(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
      data: {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`.trim(),
      },
    },
  })
  if (error) throw new Error(error.message)
}
