# Pulse — context for Claude Code

This is a personal-use money management app. **Single user (the developer/owner), no auth, runs on a Pixel 9 Pro XL (Android).** Don't suggest adding sign-in flows, multi-user RLS, or App Store deployment paths — those are explicit non-goals.

---

## What this app is

A React Native + Expo (SDK 54) app for tracking personal finances. Owner uses it to log expenses, set budgets, view a dashboard, and (eventually) manage credit card / loan debt and recurring entries. Backed by Supabase Postgres.

**Owner's currency:** PKR. The schema defaults to it.

## Tech stack

- **Expo SDK 54** with `newArchEnabled: true` (required for Reanimated 4 / Worklets)
- **React Native 0.81.5**, **React 19**
- **Expo Router** v5, file-based routing under `app/`
- **NativeWind v4** (Tailwind for RN), dark-only design system in `tailwind.config.js`
- **TanStack Query** for all data fetching, cache, optimistic updates
- **Zustand** for local UI state (entry, lock, period, preferences, transactionFilter)
- **Supabase JS** for the database (the canonical DB lives there — Drizzle is for types only on the client)
- **Drizzle ORM schema** defines table types; we don't run Drizzle from the app, only as a type source
- **Victory Native XL** + `@shopify/react-native-skia` for charts
- **expo-haptics, expo-local-authentication, expo-secure-store, expo-notifications, expo-print, expo-sharing, expo-file-system, expo-linear-gradient, expo-crypto** for the native bits
- **lucide-react-native** for icons (^0.469.0 — minimum that supports React 19)
- `.npmrc` has `legacy-peer-deps=true` because lucide's peer-dep range hasn't caught up

## Personal-mode architecture (important)

- **No Clerk, no auth.** All Clerk imports were removed. Don't reintroduce them.
- **RLS is OFF** in `supabase/migrations/0001_initial_schema.sql`. The Supabase anon key gives full access; security comes from the on-device biometric lock.
- **Single user** with `id = 'me'` is pre-inserted by the migration. Every other table has `user_id text not null default 'me'` so client inserts don't have to specify it.
- **`LOCAL_USER_ID = "me"`** is exported from `lib/supabase.ts` — use this constant when a query *does* need to filter by user (rare).
- The user row's `currency` and `name` columns are the source of truth for those preferences. All other prefs live in `stores/preferencesStore.ts` (AsyncStorage-persisted Zustand).

## File map (where things live)

```
app/
  _layout.tsx                   GestureHandlerRootView → ErrorBoundary → QueryClient → AuthGate → Slot
  (auth)/
    _layout.tsx
    lock.tsx                    biometric + PIN fallback
    onboarding.tsx              first-run only — currency + first account, then routes to /(tabs)
  (tabs)/
    _layout.tsx                 5 tabs with lucide icons + selection haptics
    index.tsx                   Home / Quick Entry — keypad, categories, account pill, recent
    dashboard.tsx               period selector + 8 cards
    transactions.tsx            search, filters, infinite list, swipe edit/delete
    calendar.tsx                month heatmap, swipe between months
    reports.tsx                 pie / bar / line + 4 stat cards + CSV export
  accounts/
    index.tsx                   list with edit pencil per row, transfer button
    [id].tsx                    detail with 90-day balance chart
  settings/
    index.tsx                   iOS-grouped list, 9 sections
    categories.tsx              CRUD
    recurring.tsx               CRUD + active toggle
  budgets.tsx                   list + summary, long-press delete
  insights.tsx                  AI insights (manual + scheduled), NL search bar

components/                     13 components — sheets, AuthGate, ErrorBoundary, Keypad, NLSearchBar, Skeleton
db/                             Drizzle schema (types) + seed (legacy, not used in personal mode)
lib/                            13 helpers — aggregations, biometric, calculator, csv, currency, icons, etc.
stores/                         5 Zustand stores
supabase/
  migrations/0001_initial_schema.sql   PERSONAL MODE — RLS off, single user pre-inserted
  functions/                    generate-insights + nl-query (Edge Functions, optional)
```

## Key conventions

1. **Account types** — `cash | bank | credit | wallet | savings`. Credit cards and loans both use `credit` with a **negative balance** (e.g., `-500` means owes ₨500). The owner is fine with this.
2. **Transfers** — stored as TWO rows linked by amount sign:
   - Source leg: `amount = -X`, type `transfer`, note `→ {dest}`
   - Destination leg: `amount = +X`, type `transfer`, note `← {source}`
   - Not atomic (two separate INSERTs with manual rollback in `components/TransferSheet.tsx`). If you touch this, consider wrapping in a Postgres function.
3. **`numeric` columns** round-trip through Postgres as `string` — convert with `Number()` at the boundary.
4. **Charts** — every `<CartesianChart>` must guard against zero-variance data; otherwise Skia crashes ("value is undefined, expected a number"). See `app/accounts/index.tsx` for the pattern (`hasVariance` check → fall back to a flat bar).
5. **Numeric inputs** — always include `clearButtonMode="while-editing"` for iOS plus a manual `<Pressable>` × button for Android. See AccountSheet, BudgetSheet, etc.
6. **Long-press to delete** is the convention for cards. Add a visible icon button too — long-press alone isn't discoverable.
7. **Routing** — AuthGate gates the app: zero accounts → onboarding, lock timeout exceeded → lock screen, else tabs. Lives in `components/AuthGate.tsx`.

## Known issues / caveats (not yet fixed)

- **Recurring entries don't materialize.** No worker scans `recurring.next_run` and inserts transactions. Would be a Supabase Edge Function on a daily cron.
- **AI Edge Functions still expect `Authorization` header.** They were written before the personal-mode refactor. They'll return 401. Either skip the Insights tab (the empty state is graceful) or rewrite the functions to drop the auth check and assume `LOCAL_USER_ID = 'me'`.
- **Daily reminder toggle doesn't actually schedule notifications.** `prefs.dailyReminderEnabled` saves but nothing reads it. Need a `Notifications.scheduleNotificationAsync({ trigger: { hour, minute, repeats: true } })` tied to the toggle.
- **Budget alerts toggle isn't honored.** `runBudgetCheck()` always fires regardless of `prefs.budgetAlertsEnabled`. One-line gate.
- **CSV import** — settings row says "Coming soon". Not built.
- **Light theme** — `users.theme` round-trips but UI is dark-only.
- **Custom date range picker** — both reports' "Custom" period and the transaction filter sheet's date range fall back to presets. Add `@react-native-community/datetimepicker` if needed.
- **Edit sheet handles transfer rows naively.** Editing one leg desyncs the pair. Detect `type === "transfer"` and either lock the amount or edit both legs.
- **Sparkline rendering uses peak/min only.** Account list rows skip the chart when all values are equal (showed up in early testing).

## Build / deployment

The owner installs via **EAS Build → APK** (preview profile in `eas.json`). No Play Store, no Apple Developer account.

```bash
eas build --profile preview --platform android
```

`eas.json` includes `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` inline — fine for personal use, but **don't** commit that file with real keys to a public repo. (The current repo at `github.com/holycow01/MoneyManage` is private; it's currently committed there.)

The build has been failing repeatedly through SDK 54's quirks. Working state at the time of this handoff:
- ✅ `npm ci` passes (`.npmrc` with `legacy-peer-deps=true`)
- ✅ Gradle compiles all native modules
- ✅ JS bundle generated by Metro
- ✅ Reanimated/Worklets requirement satisfied (`newArchEnabled: true`)
- ⚠️ Last failure: `processReleaseResources` couldn't find `drawable/splashscreen_logo`. Fixed by:
  - Generating placeholder PNGs (`assets/icon.png`, `assets/adaptive-icon.png`, `assets/splash-icon.png`) via the Python script in the chat
  - Adding `image: "./assets/splash-icon.png"` to the `expo-splash-screen` plugin block in `app.json`
- The PNGs are SOLID-COLOR placeholders. The owner can replace them later via Figma export of `assets/icon.svg` / `assets/splash.svg`.

## Outstanding tasks the owner asked about

In rough priority order:

1. **Get a successful EAS build of the APK.** This is the immediate goal. After fixing the splash-icon issue, the next build should succeed. If it fails again, read the gradlew logs and fix forward.
2. **Home-screen widget for quick expense entry.** Owner wants this. Three levels of effort discussed:
   - **App shortcuts** (long-press app icon → "Quick add Food", etc.) — easiest, ~30 mins
   - **Persistent notification** with action buttons — ~3 hrs, closest UX to a true widget
   - **Native Android home-screen widget** — Kotlin + AppWidgetProvider + RemoteViews + custom config plugin — 1–2 days
   The owner is open to any of these. Default recommendation: ship app shortcuts first, see if it's enough.
3. **Re-enable AI insights** by rewriting the Edge Functions to skip auth and use `LOCAL_USER_ID = 'me'`.
4. **Wire the daily reminder toggle** to actually schedule the notification.
5. **Recurring entry materialization worker** — Supabase Edge Function on a daily cron.

## Hard-won lessons (don't relitigate)

- Don't suggest re-adding `expo-updates` — it caused `fs-extra` resolution failures and isn't needed for personal use.
- Don't suggest `react-native-draggable-flatlist` — it crashes silently against Reanimated 4. The accounts list uses a plain `FlatList` now.
- Don't suggest `keyboardType="decimal-pad"` is enough for Android — there's no visible backspace; always pair with the manual `×` button pattern.
- Don't suggest splash screens can be opted out of — `expo-splash-screen` always emits a `splashscreen_logo` reference. You have to provide an image.
- Don't add typescript strict checks on the codebase right now without a quick local typecheck — there are some legacy `any`s from the Clerk era.

## Owner preferences

- Wants a clean dark UI. Don't introduce light-theme variants without explicit ask.
- Wants honest engineering: ship working code, surface caveats, don't oversell.
- Comfortable with shell + git, less so with native build internals.
- Uses Pixel 9 Pro XL. Don't optimize for iOS unless asked.

---

**Start here when picking this up:** check whether the latest EAS build succeeded. If yes, get the APK on the phone and ask what to tackle next. If no, paste the new gradlew error and debug forward.
