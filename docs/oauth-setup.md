# OAuth provider setup

The code is done; these are the console steps that make it work. Nothing here
lives in the repo, so a provider that "doesn't work" is almost always a missing
step on this page rather than a bug.

Supported: **Google**, **LinkedIn (OIDC)**, **GitHub**, **Apple**.

---

## 1. The one setting that matters for security

**Authentication → Providers → General → "Allow unverified email logins": OFF.**

Supabase links a new social identity to an existing user when the provider
returns a **verified** email that matches. That is what makes "sign in with
Google" land on the same account someone created with a password.

With unverified logins allowed, that linking becomes an account-takeover path:
anyone who can create an account at *any* enabled provider using a victim's
address inherits the victim's Zenith account, resumes and interview history
included. The weakest provider sets the security of every account.

Leave it off. If a provider genuinely cannot supply a verified email, do not
enable that provider.

---

## 2. Redirect URLs

Every provider console needs the **Supabase** callback — not the app's:

```
https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback
```

This trips people up: the browser goes provider → Supabase → app. The app's own
`/auth/callback` is configured in Supabase, not in the provider console.

Then in **Supabase → Authentication → URL Configuration → Redirect URLs**, allow:

```
http://localhost:3000/auth/callback
https://<your-production-domain>/auth/callback
```

Add every preview domain you actually use. A redirect URL that is not on this
list fails *after* the user has authenticated, which reads as a broken app
rather than a misconfiguration.

Set **Site URL** to the production origin.

---

## 3. Per-provider notes

### Google
Cloud Console → APIs & Services → Credentials → OAuth client ID (Web).
Authorized redirect URI: the Supabase callback above.

We do **not** send `access_type=offline` or `prompt=consent`. A refresh token is
only needed to call Google APIs as the user, which Zenith never does, and
`prompt=consent` forces the consent screen on *every* sign-in — friction for
returning users with no benefit. Add them only if that changes.

### GitHub
Settings → Developer settings → OAuth Apps. Authorization callback URL is the
Supabase callback.

⚠️ GitHub only returns an email if the account has a **verified public or
primary email**. Users with private emails may arrive without one, and with
unverified logins off they will not link. This is correct behaviour; the error
copy on `/login` covers it.

### LinkedIn (OIDC)
Use **LinkedIn (OIDC)** in Supabase, not the legacy "LinkedIn" entry. In the
LinkedIn developer app, request the **Sign In with LinkedIn using OpenID
Connect** product — without it the app returns scope errors at sign-in.
Required scopes: `openid`, `profile`, `email`.

### Apple
The most involved, and the only one that expires.

- Requires a paid Apple Developer account.
- Create an **App ID**, then a **Services ID** (the Services ID is the client ID).
- Create a **Sign in with Apple key** (.p8) and note the Key ID and Team ID.
- The client secret is a **JWT you generate**, and Apple caps its lifetime at
  **6 months**. It is not a static string. Put a calendar reminder on it —
  when it lapses, Apple sign-in fails for everyone with no code change to blame.
- Apple returns the user's name **only on first authorization**, never again.

If you want social auth working this week, ship Google + GitHub first and add
Apple deliberately.

---

## 4. Verifying

For each provider, in an incognito window:

1. `/login` → click the provider → you should reach its consent screen.
2. Approve → you should land on `/dashboard` already signed in.
3. Cancel instead → you should land on `/login` with "Sign-in was cancelled",
   not a stack trace.

Then verify **linking**, which is the part worth testing properly:

1. Register with email + password using an address you control.
2. Sign out, then sign in with a provider using **the same** address.
3. You should land in the **same account** with the same history — not a second
   empty one.

If step 3 creates a new account, the provider did not return a verified email.
Check that provider's email settings before touching anything in the code.
