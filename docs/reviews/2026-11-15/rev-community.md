# rev-community — agenda, tickets, workshops, meetups, HQ, people, posts (2026-11-15)

Area: all 23 files in the task list were read once. Paths below are relative to `app/src/`.

## Fixed

- `app/agenda/ticket/[id].tsx:28-48` — a ticket opened from a notification on a cold start fired its request before the saved session was restored (no token → one-time error). The query now waits for `status === 'signedIn'`, shows the loading skeleton while `status === 'loading'`, and a sign-in button for a guest.
- `app/hq/pass/[id].tsx:28-45` — same cold-start/guest fix for the HQ entry pass.
- `app/agenda/ticket/[id].tsx:52` and `app/hq/pass/[id].tsx:47` — `STATE[ticket.state]` / `STATE[pass.state]` crashed the screen (reading `.icon` of undefined) if the server ever sent a state outside upcoming/active/expired; now falls back to `upcoming`.
- `app/agenda/[id].tsx:74-79` — the top «احجز» button books from the head of the page, but the refusal (profile gate, closed, full…) renders in the booking block far below; the member saw nothing happen. `onError` now scrolls to the booking block.
- `app/agenda/[id].tsx:112` — the hero image bypassed `sized()` (full-size upload on every open); now `sized(event.imageUrl, 400)`.
- `app/agenda/index.tsx:61` — `EventDateBadge` read the month in the phone's time zone; at a month end a phone east of UTC+12 showed the next month. Now `timeZone: 'UTC'` (the date is a plain calendar day).
- `components/WorkshopAd.tsx:58-61, 93-96` — the popup card was not scrollable: on a small phone or a big system font the card is taller than the screen and «لاحقًا» (the only way out on iOS) fell off-screen. The content now scrolls inside a card capped at 88 % of the window height (a clipped, unreachable button has one right answer; the look is unchanged on a phone where it fits).
- `components/WorkshopRecordings.tsx:87` — the play icon on the gold disc used `colors.black` (which is the pale page colour in light mode → washed out on gold); now `colors.goldInk`.
- `app/hq/index.tsx:45, 64-76` — «إلغاء الحجز» could be double-fired while the request was in flight; taps are now ignored until it settles.
- `app/hq/index.tsx:238` (`cancel` style) — the cancel button was about 38 pt high; now `minHeight: 44`.
- `app/hq/book.tsx:93` — after a refused booking (slot just taken, overlap) the slot list stayed stale and still showed the slot as free; it now refetches.
- `app/hq/admin.tsx:63` — «تحقق» with an empty code sent an empty request to the server; now ignored.
- `app/people/[id].tsx:199` — the contact link rows were ~32 pt high; now `minHeight: 44`.
- `app/people/apply.tsx:34, 68, 117` — after submitting the long form the «تم الإرسال» notice is at the very top, off-screen; the member saw the button stop spinning and nothing else. The screen now scrolls to the top on success. (Kept together with the agenda scroll-on-refusal above: both make a result that was invisible visible; each is a one-line revert if the coordinator prefers another placement.)
- `app/workshops.tsx:60` — an empty `data.note` rendered an empty info box; hidden now.
- `app/meetups.tsx:42` — an empty meetups list showed a blank screen; now the standard empty state.
- `app/meetup/[key].tsx:35` — a stale deep link to a key that is not in the loaded content showed a blank screen (StateView with no loading/error returns null); now shows the empty state.
- `app/posts/[id].tsx:93, 240` — the post images and the uploaded-video poster bypassed `sized()`; now `sized(…, 400)`. Image keys now include the index (duplicate URLs gave duplicate-key warnings), and the images carry the post title as accessibility label.
- `components/PostsBlock.tsx:123` — `PostCard` (home block and the list) had no button role/label for screen readers; added `accessibilityRole="button"` and the post title as label.

### Applied in round 2 (coordinator decisions, 2026-11-15)

- `app/hq/index.tsx:77-83, 164` — «إلغاء الحجز» now asks first: native `Alert` with `hq.cancelBooking` as the title and the destructive button, `common.close` to back out (existing strings only).
- `app/hq/index.tsx:30-33, 113` — the map button opens the maps app: `Linking.openURL(url).catch(() => openLink(url))` (the in-app browser stays as the fallback).
- `app/people/[id].tsx:20-23, 105, 111` — the WhatsApp and `mailto:` rows open their own apps the same way (`mailto:` used to throw inside `openBrowserAsync` and only worked through the fallback).
- `app/hq/book.tsx:196` — unavailable slots are `dimmed` (they only differed by label).
- `app/agenda/ticket/[id].tsx:161`, `app/hq/pass/[id].tsx:157` — the white QR box has a 1 px `colors.border` frame (it melted into the white ticket in light mode; the white quiet zone is untouched).
- `components/WorkshopAd.tsx:93` — `statusBarTranslucent` on the popup `Modal` (the backdrop covers the Android status bar).
- `app/posts/compose.tsx:78-96` — sending asks first: `Alert` with `posts.confirmSend.title` / `posts.confirmSend.text`, buttons `common.cancel` and `compose.send`. Validation still runs before the question; the request itself moved to `deliver()` (line 98) with an in-flight guard.
- `app/meetup/[key].tsx:29, 41, 67` — the page passes a `scrollRef` to `Screen` and `FormEmbed`, so the registration form scrolls to its first red field.
- Riyadh time (item 6): checked every file of mine. Event and poll times go through `formatEventDate` (`app/posts/[id].tsx` poll deadline and event card, `components/PostsBlock.tsx`), which the coordinator moved to the Riyadh clock — nothing to change in my files. The only `formatArabicDateTime` left is `app/hq/pass/[id].tsx:74` («تاريخ الحجز»), kept on the member's own clock as decided. Agenda times are server wall-clock strings and the countdown already uses `+03:00`.
- `components/VerifiedBadge.tsx:25-29, 52` — the grey seal literal `#9AA3AF` → `colors.textMuted` (read through `lazyTokens`, never at module scope) and the inner disc `#FFFFFF` → `colors.white`. The gold glow string on the member tier stays a literal: it is the brand halo, not a themed surface.
- `app/agenda/index.tsx:54-66, 193-196` + `app/agenda/[id].tsx:116` — the date chip's dark glass `rgba(7, 7, 8, 0.72)` is right where the chip sits ON a photo (agenda list, home strip: dark in both themes), so it stays there. On the event page the chip sits on the page itself: new `onPage` prop → `colors.surface` background, `colors.goldText` day, `colors.textSecondary` month. Dark mode looks the same as before; light mode gets a themed chip instead of a dark block.

## Problems not fixed

- **Medium — QR is not shown at full brightness.** Neither ticket nor HQ pass raises the screen brightness or keeps the screen awake, so a dimmed phone is hard to scan at the door. Left because `expo-brightness` is not in `package.json` (no new packages, and it is a native module → needs a new store binary, not OTA). Proposal: add `expo-brightness` + `expo-keep-awake`, load them through `requireOptionalNativeModule` (see the OTA native-module crash note), raise brightness in `useFocusEffect` on both screens and restore on blur. (Coordinator: not now — needs native packages.)
- **Low — «اليوم / غدًا» labels do not exist** on agenda cards (only the date badge and the countdown), so nothing to mis-render; if the owner wants them it is a feature. (Coordinator: not now.)
- **Low — `past` on the agenda comes from the server at fetch time.** A list left open past the end of an event keeps showing it as upcoming until the next refetch (staleTime 30 s, refetch on focus). The countdown itself disappears correctly (`FlipCountdown` returns null at zero).
- **Low — workshop popup photo is `cover` at a fixed 190 pt height**, so a portrait flyer is cropped (never stretched). It follows the owner's M177 design; changing to `contain` or a measured aspect ratio is a design choice. (Coordinator: not now.)
- **Low — `hq/book.tsx` lets a member submit a space booking with 0 wallet hours left** (the warning notice shows, the button stays enabled); the server rejects it with a message. Not disabled so the server stays the single judge.
- **Low — the date badge shows the day with a leading zero («05»)** while the text lines show «5 نوفمبر». Design detail. (Coordinator: not now.)
- **Info — features in the brief that are not in this client:** meetups (M119) are a video page + registration form (`FormEmbed`), with no join/leave/capacity/location in the app; the «members directory» is the approved «شخصية ومسيرة» roster (no search, no pagination, the home strip shows the first 10); «posts» are the management messages inbox (no member compose, delete, report or image attach; admin compose has no image attach). Nothing to fix there.
- **Info — English event fields (M239):** the app sends `x-app-lang` on every request and does no client-side fallback; events missing English depend entirely on the server backfill. The persisted query cache is dropped on a language switch (`lib/queryCache.ts`), and `/api/workshop-ad` answers per language (server `agenda/ad.ts`), so no Arabic popup in English mode from the client side.
- **Info — 403 on admin screens:** `hq/admin.tsx`, `posts/compose.tsx` check `me.isAdmin` AND the server decides; a 403 from `useAdminVisits` shows the standard error state with the server message, a failed decide/verify shows a warning notice. No reliance on hiding alone.

## Shared-file changes needed

1. DONE by the coordinator (`formatRiyadhDateTime` is in `lib/format.ts:157`, `formatEventDate` uses it at line 170). Kept here as the record of what was asked — `lib/format.ts` (owner of `lib/**`) — show exact event times in Riyadh time. Add above `formatEventDate`:

```ts
/** "12 سبتمبر 2026 · 14:05" on the Riyadh clock (UTC+3, no daylight saving), for event times. */
export function formatRiyadhDateTime(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  const riyadh = new Date(instant.getTime() + 3 * 3_600_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${riyadh.getUTCFullYear()}-${pad(riyadh.getUTCMonth() + 1)}-${pad(riyadh.getUTCDate())}`;
  return `${formatArabicDate(day)} · ${pad(riyadh.getUTCHours())}:${pad(riyadh.getUTCMinutes())}`;
}
```

and in `formatEventDate` (line ~147) change

old: `return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatArabicDate(date) : formatArabicDateTime(date);`
new: `return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatArabicDate(date) : formatRiyadhDateTime(date);`

(leave `formatArabicDateTime` as is: the HQ pass «تاريخ الحجز» is a moment on the member's own clock.) Also update the doc comment of `formatEventDate` ("shown in the device's local time" → "on the Riyadh clock").

2. `package.json` (no owner session named; native change, needs the owner's OK and a new binary): `expo-brightness`, `expo-keep-awake` for the QR screens (see the first medium problem). My two screens are ready to call them once they exist.

## Checks run

- `cd app; npx tsc --noEmit` → no errors (whole project, run three times: after the first fixes, after reverting the five choices, and after round 2; other sessions' edits included).
- `npx eslint` on the changed files (three times, clean each time; round 2 added `app/posts/compose.tsx` and `components/VerifiedBadge.tsx`, 18 files in all) (`app/agenda/index.tsx`, `app/agenda/[id].tsx`, `app/agenda/ticket/[id].tsx`, `app/hq/index.tsx`, `app/hq/book.tsx`, `app/hq/admin.tsx`, `app/hq/pass/[id].tsx`, `app/workshops.tsx`, `app/meetups.tsx`, `app/meetup/[key].tsx`, `app/people/[id].tsx`, `app/people/apply.tsx`, `app/posts/[id].tsx`, `components/PostsBlock.tsx`, `components/WorkshopAd.tsx`, `components/WorkshopRecordings.tsx`) → clean.
- Not run (rules): Metro, emulator, device, `eas`. Behaviour above is from reading the code; the WorkshopAd scroll cap, the cold-start ticket, the maps / WhatsApp / mail hand-off and the two confirmation dialogs are worth one look on a real iPhone and an Android phone in the 1.3.4 build.
- Unchanged and read without finding a defect: `app/people/index.tsx`, `app/posts/index.tsx`, `components/AgendaBlock.tsx`, `components/MeetupsBlock.tsx`, `components/PeopleBlock.tsx`.
