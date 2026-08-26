# OAuth provider setup

The code is done; these are the console steps that make it work. Nothing here
lives in the repo, so a provider that "doesn't work" is almost always a missing
step on this page rather than a bug.

Supported: **Google**, and only Google.

Every enabled provider is a party trusted to vouch for an email address,
because Supabase links a new identity to an existing user whenever the
provider returns a matching verified email. GitHub, LinkedIn and Apple were
all removed for that reason — Apple as well, since it also has no credentials
configured, and its client secret is a JWT Apple caps at 6 months: adding it
back later needs an owner for that renewal, not just the setup steps.
Removing the buttons is not enough on its own: **disable every other provider in the
Supabase dashboard**, or an old endpoint stays live with nothing pointing at
it. Checked directly against this project's `/auth/v1/settings` while writing
this: `google` and `email` are the only two enabled, so that step is already
done here.

## Your callback URL

Paste this into **every** provider console. It is the Supabase callback, not
the app's — the browser goes provider → Supabase → app.

```
https://flgumfsuyipzdgaotphc.supabase.co/auth/v1/callback
```

## Check progress at any point

```
npm run check:oauth
```

Reports which providers Supabase currently has enabled and whether email
verification is on. Run it after each provider to confirm the dashboard saved,
rather than finding out from a failed sign-in.

Baseline: 0/4 enabled, email verification on.

---

## 1. The one setting that matters for security

**Authentication → Providers → General → "Allow unverified email logins": OFF.**

Supabase links a new social identity to an existing user when the provider
returns a **verified** email that matches. That is what makes "sign in with
Google" land on the same account someone created with a password.

With unverified logins allowed, that linking becomes an account-takeover path:
anyone who can create an account at *any* enabled provider using a victim's
address inherits the victim's ApplyCenter account, resumes and interview history
included. The weakest provider sets the security of every account.

Leave it off. If a provider genuinely cannot supply a verified email, do not
enable that provider.

---

## 2. Redirect URLs

Every provider console needs the **Supabase** callback — not the app's:

```
https://flgumfsuyipzdgaotphc.supabase.co/auth/v1/callback
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

⚠️ An **External** consent screen starts in **Testing**, where only email
addresses you add as test users can sign in at all (max 100), and issued
refresh tokens expire after 7 days. It works for you and looks broken for
everyone else. Click **Publish app** before real users touch it — that is the
step people miss.

We do **not** send `access_type=offline` or `prompt=consent`. A refresh token is
only needed to call Google APIs as the user, which ApplyCenter never does, and
`prompt=consent` forces the consent screen on *every* sign-in — friction for
returning users with no benefit. Add them only if that changes.

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
