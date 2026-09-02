# ApplyCenter — mobile

React Native on Expo, targeting iOS and Android. Talks to the same FastAPI
backend as `frontend/`, and shares its design tokens and its Supabase
project — but it is a separate app, not a port.

## Running it

```bash
cd mobile
npm install
cp .env.example .env                 # fill in the Supabase values
npm start
```

Then scan the QR code with Expo Go, or press `a` / `i` for an emulator.

`EXPO_PUBLIC_*` variables are inlined into the bundle at build time, the same
way `NEXT_PUBLIC_*` are on the web. A build made without them ships pointed
at `localhost`, which works on a simulator and on nothing else.

### Building for a device

iOS builds do not need a Mac — EAS builds them in the cloud:

```bash
npx eas build --profile development --platform ios
npx eas build --profile development --platform android
```

`EAS_PROJECT_ID` must be set before either — `app.config.ts` reads it into
`extra.eas.projectId`, which is what `getExpoPushTokenAsync` needs in a
standalone build. Expo Go can infer it; a compiled binary cannot, and without
it push registration throws at runtime rather than failing the build.

Get it from `npx eas project:info`. Each profile in `eas.json` injects its own
`EXPO_PUBLIC_API_URL`, so a preview build points at staging and a production
build at production without anyone editing a file.

## What is here

Four tabs, which is the core loop rather than a port of all sixteen signed-in
web routes. The tailor workspace, the analytics charts and the reports view
are genuinely desktop-shaped and would be worse on a phone, not better for
being present.

| Screen | State |
| --- | --- |
| Jobs | Two-column grid, search, work-mode filter, pull to refresh |
| Applications | Filtered by the same four groups the web board uses |
| Resume | Latest score and history — read only for now |
| Settings | Theme, biometric lock, push permission, sign out |

Auth is email and password against Supabase, with sign-up and a lock screen.

## The parts worth knowing about

**The session lives in the keychain.** Every React Native Supabase example
hands the client `AsyncStorage`, which is an unencrypted SQLite file in the
app sandbox. `src/lib/supabase.ts` hands it `SecureStore` instead, pinned to
`WHEN_UNLOCKED_THIS_DEVICE_ONLY` — so the refresh token is in Keychain
Services or the Android Keystore, and restoring a backup onto a new phone
does not carry a signed-in session with it.

**Biometric lock is a second gate, not the same one.** The keychain protects
the token; the lock protects the session from someone holding an
already-unlocked phone. It re-locks after a minute in the background, not on
every blur — a prompt every time you glance at a notification is a feature
people turn off.

**Push permission is asked for in Settings.** iOS gives one chance at that
prompt for the life of an install, and asking on launch, before anyone knows
what the app does, is the quickest way to a permanent no.

**Depth is colour, not shadow.** The web design system carries elevation in
five neumorphic shadows, each two-sided — a light source and a dark one.
React Native gives you one shadow on iOS and an elevation integer on Android,
so that technique does not survive the crossing. `canvas`, `canvasRaise` and
`canvasElevated` are three genuinely different values here and a card is the
one above its background, which reads as the same system without pretending
to be the same method.

**Tokens are ported, not shared.** `src/theme/tokens.ts` carries the same
values as `frontend/src/app/globals.css` and says so. A generator would be a
build step to maintain for two dozen constants that change roughly never; the
contract is that the numbers match, and the web side's contrast gate is what
proves the colours clear AA.

## Not done yet

- Interview practice.
- Offline caching beyond React Query's in-memory cache.
- Nothing here has been run on a device or a simulator. Types check and the
  backend it talks to is tested, but no screen has been seen.
