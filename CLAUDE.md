# Investors Club App — تطبيق نادي المستثمرين

Monorepo for the نادي المستثمرين mobile app (Vibes Holding ecosystem), published by شركة المجتمع الافتراضي للاستثمار (vcmem.com).
Full scope, business facts, integrations and milestones: `docs/PROJECT_BRIEF.md`. Read the relevant section before building any feature, and update the milestone status there when a milestone is done.

## Repo layout
- `app/` — Expo (React Native + TypeScript), iOS + Android
- `server/` — Node.js + TypeScript API with PostgreSQL, deployed on Railway
- `admin/` — web dashboard (later milestone)
- `docs/` — brief and decisions

## Working with the owner
- The owner works on Windows. Give PowerShell-compatible commands: short, one step at a time.
- The owner writes in Arabic (Egyptian dialect). Explain in simple Arabic. Code, comments and commit messages in English.
- Run commands yourself when possible. Ask before anything that costs money, publishes, or touches a live system.
- EAS builds count against a monthly quota. Do not trigger builds casually; prefer OTA updates for JS-only changes.
- Current environment: TEST. Never switch anything to production unless the owner says so explicitly.

## Hard rules
1. No secrets in code, git, logs or chat. Paymob secret key, API key and HMAC, the OpenAI key, and the hub/Projects Bank bridge keys live only in environment variables (git-ignored `.env`, Railway variables, EAS environment variables). The app may contain only public values (API base URL, Paymob public key).
2. One identity source: accounts and memberships belong to the vcmem.com hub (Vibes AI Assistant plugin). The server never keeps its own separate member registry; it proxies and caches hub data.
3. The annual membership is purchased in-app only through Apple IAP / Google Play Billing (later milestone). Never show Paymob membership links, representative payment links, web prices, or any call to action to pay for membership outside the app. Paymob inside the app is for real-world services only.
4. Founder contact data (whatsapp, email, website) and pitch decks from the Projects Bank feed never reach the app unless that member unlocked that project. Enforce on the server and strip these fields from every other response.
5. Trust payment status only from server-side, HMAC-verified Paymob callbacks, never from the client SDK result.
6. Never change the existing Paymob integration callback URLs and never recreate Paymob keys: vcmem membership auto-activation depends on them. App payments use a per-payment notification URL that points to this server.
7. News items are never written by AI. Show only real items whose URL the server fetched successfully: original title, source name, time, the source's own snippet, and a «اقرأ من المصدر» button that opens the original page in-app. AI may only classify, deduplicate and rank.
8. User-specific API responses send `Cache-Control: no-store`. If Cloudflare or any CDN sits in front, bypass its cache for `/api/*`.
9. Preview builds use a separate app id (`.preview` suffix) and the name «نادي المستثمرين (تجريبي)». Once auth exists, preview builds allow login for hub admin accounts only.

## UI and copy rules
- Arabic-first, forced RTL on both platforms. Font: IBM Plex Sans Arabic.
- Never use «مجاني / مجانًا / مجانية»; always «بدون رسوم».
- Use «رصيد» (not كريديت) and «الشراكات» (not الصفقات).
- Numeric ranges in Arabic text must display the first value on the right: write en-dash ranges in logical order (`7%–8%`) or use words (من … إلى …). Never put a hyphen-minus between two numbers.
- Store and marketing wording: business club, partnership opportunities, services. No promised returns. Valuations always carry the disclaimer from the brief.
- Marketing content (benefits, prices, banners, golden companies, videos) is server-driven so the owner edits it from the dashboard. Do not hardcode it in the app.

## Stack
- App: Expo SDK (latest stable), TypeScript, expo-router, TanStack Query, expo-secure-store (tokens), expo-font, expo-updates. Later: expo-notifications, Paymob React Native SDK, RevenueCat.
- Server: Node.js LTS + TypeScript, Fastify, PostgreSQL, Zod validation, scheduled jobs.
- Delivery: EAS Build / Submit / Update. Source in a private GitHub repo.

## EAS profiles (`app/eas.json`)
- `development`: development client, internal distribution.
- `preview`: `distribution: internal`, Android `buildType: apk`, channel `preview`, `APP_ENV=test`, app id with `.preview` suffix.
- `production`: store distribution, channel `production`, `autoIncrement: true` with `cli.appVersionSource: remote`.

## Common commands (inside `app/`)
- Dev server: `npx expo start`
- Android test APK: `eas build --platform android --profile preview`
- OTA update to testers: `eas update --channel preview --message "short english message"`
- Production release (later): `eas build --platform all --profile production --auto-submit`

## Budget discipline (the owner pays for every token and every build)
- Before any task, give a short plan (max 5 bullets) and wait for the owner's OK before executing.
- Read only the files the task needs. Never scan the whole repo, node_modules, lock files, .expo or build output. Prefer targeted search over reading whole files, and do not re-read unchanged files.
- Keep replies short: no long explanations, no pasting code back, no recaps.
- If the same error survives 2 fix attempts, stop, explain in simple Arabic, and ask. Never loop.
- No subagents, parallel agents, web browsing or MCP tools without the owner's OK.
- Never run eas build or any paid or quota-limited action without the owner's explicit OK in the current message. Typecheck and lint must pass locally first. Prefer OTA updates.
- Add only the packages the task needs. Ask before adding any paid service.
- One milestone per session. At the end, update the milestone checklist in docs/PROJECT_BRIEF.md with a short status so a new session can continue without re-exploring, then tell the owner to start a new session.
