# Investors Club App — تطبيق نادي المستثمرين

Monorepo for the نادي المستثمرين mobile app (Vibes Holding ecosystem).

- `app/` — Expo (React Native + TypeScript) app for iOS and Android
- `server/` — Node.js + TypeScript API (milestone M2)
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

## Environments

- `APP_ENV` is set per EAS profile in `app/eas.json` (`test` for development and preview, `production` for store builds).
- Preview builds use the app id `com.vcmem.investorsclub.preview` and the name «نادي المستثمرين (تجريبي)». Production uses `com.vcmem.investorsclub`.
- The current environment is TEST. Nothing is switched to production without the owner's explicit go-ahead.

## Rules

Working rules, hard rules and copy rules live in `CLAUDE.md`. The full scope, business facts and milestone status live in `docs/PROJECT_BRIEF.md`.
