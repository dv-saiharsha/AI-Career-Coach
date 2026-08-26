# Email templates

Paste into **Supabase Dashboard → Authentication → Emails**, one template per tab.

| File | Supabase template |
|---|---|
| `confirm-signup.html` | Confirm signup |

## Why these are written the way they are

**Tables and inline styles, not modern CSS.** Outlook on Windows renders mail
through Word's HTML engine. Flexbox and grid do nothing there, and `<style>`
blocks are stripped by several clients including Gmail's web app in some
configurations. Every rule is inline and every layout is a table.

**Literal hex, not CSS variables.** Email has no custom property support, so
the palette is duplicated here rather than referenced. If `globals.css`
changes, these need updating by hand — that duplication is unavoidable, not an
oversight.

**The wordmark is text, not an image.** Most clients block remote images until
the reader opts in. A logo that fails to load makes a legitimate email look
broken or spoofed, which is the opposite of what a confirmation mail needs to
convey.

**The button is a padded table cell.** A styled `<a>` collapses to unstyled
blue text in Outlook. The link is repeated in full below it, because some
clients mangle long hrefs and a reader who cannot click still needs a route in.

## Supabase variables

Do not rename these — Supabase substitutes them at send time:

- `{{ .ConfirmationURL }}` — the confirm link
- `{{ .Email }}` — the address being confirmed

Other templates can also use `{{ .Token }}` (6-digit OTP), `{{ .TokenHash }}`,
and `{{ .SiteURL }}`.

## Before relying on this in production

Supabase's built-in SMTP is rate limited to a handful of messages per hour and
is intended for development. It will silently throttle a real signup flow.
Configure your own SMTP provider under **Project Settings → Authentication →
SMTP Settings** before launch, or confirmation emails will stop arriving once
signups pick up.
