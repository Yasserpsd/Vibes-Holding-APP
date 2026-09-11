# Investors Club App — تطبيق نادي المستثمرين

Monorepo for the نادي المستثمرين mobile app (Vibes Holding ecosystem).

- `app/` — Expo (React Native + TypeScript) app for iOS and Android
- `server/` — Node.js + TypeScript API (Fastify + PostgreSQL), deployed on Railway
- `admin/` — web dashboard (later milestone)
- `docs/` — project brief and decisions (`docs/PROJECT_BRIEF.md`)

## Requirements

- Node.js 24 LTS and npm
- EAS CLI: `npm install -g eas-cli`, then `eas login`
- Android phone (or emulator) for testing the preview APK

## First-time setup (Windows PowerShell)

```powershell
cd C:\Projects\vibes-club-app\app
npm install
```

## Daily commands (inside `app/`)

| Task | Command |
| --- | --- |
| Start the dev server | `npx expo start` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Check dependency health | `npm run doctor` |
| Android test APK (counts against the EAS build quota) | `eas build --platform android --profile preview` |
| OTA update to testers (JS-only changes) | `eas update --channel preview --message "short english message"` |

## Server (inside `server/`)

| Task | Command |
| --- | --- |
| Run locally with auto-reload (port 3000) | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Tests | `npm test` |
| Print the Projects Bank feed shape (private values masked) | `npm run feed:inspect` |
| Write the golden portal seed again | `npm run seed -- --force` |
| Production start (what Railway runs) | `npm run build` then `npm start` |

Endpoints: `GET /health`, `GET /api/projects?q=&sector=&stage=&sort=latest|views|discover|golden&page=&limit=`, `GET /api/projects/filters`, `GET /api/projects/:id`, `GET /api/golden`. Founder contact fields never leave the server.

Without `DATABASE_URL` the server keeps content in memory (fine locally). Without `PB_FEED_KEY` the Projects Bank list stays empty.

### Railway (test environment)

1. Create a Railway project with an environment named `test`, a service deployed from this GitHub repo with **Root Directory** `server`, and add the **PostgreSQL** plugin (it injects `DATABASE_URL`).
2. Service variables: `APP_ENV=test`, `PB_FEED_KEY=<the feed key>`, optionally `PB_REFRESH_MINUTES=10`. Railway sets `PORT` itself.
3. Generate a public domain for the service and check `https://<domain>/health`.
4. Put that URL in `app/.env` as `EXPO_PUBLIC_API_URL` (also in `app/eas.json` under the development and preview profiles) before running `eas update` or a build.

## Environments

- `APP_ENV` is set per EAS profile in `app/eas.json` (`test` for development and preview, `production` for store builds).
- Preview builds use the app id `com.vcmem.investorsclub.preview` and the name «نادي المستثمرين (تجريبي)». Production uses `com.vcmem.investorsclub`.
- The current environment is TEST. Nothing is switched to production without the owner's explicit go-ahead.

## Rules

Working rules, hard rules and copy rules live in `CLAUDE.md`. The full scope, business facts and milestone status live in `docs/PROJECT_BRIEF.md`.
