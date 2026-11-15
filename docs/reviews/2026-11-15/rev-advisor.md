# rev-advisor — AI advisor (chat, voice, file analysis)

Session: `rev-advisor`, 2026-11-15. Files read once: `app/(tabs)/advisor.tsx` and the 12 files of `components/advisor/`; read-only: `api/advisor.ts`, `lib/advisorBalance.ts`.

**Nothing here ran on a phone or the emulator.** Every change is checked by `tsc` and `eslint`, plus a Node check of the new markdown patterns and of the string keys.

Round 2 (coordinator's decisions): proposals 1 to 8, the three voice/file strings and the markdown marks are applied and listed under `Fixed`. Changed files: 8.

## Fixed

Sending and the thread
- `components/advisor/AdvisorChat.tsx:179` — double send: a quick-reply, welcome or opening chip tapped twice (or tapped while the composer's message was still in the app-action check) sent the message twice, because `chat.sending` only flips after that check. One `submitting` guard covers the composer and every chip.
- `components/advisor/useAdvisorChat.ts:163` — the same guard at the lowest level (`sendingRef`): `send()` refuses a second call while one is on its way.
- `components/advisor/useAdvisorChat.ts:116,120` — a poll that finished while a message was being sent added the hub's copy next to the optimistic bubble; the id swap then left the member's message in the thread twice until the next reload. Polls are skipped (and their result dropped) during a send.
- `components/advisor/useAdvisorChat.ts:59,75,108` — after a failed send the hook reloads the history, and that reload replaced the whole list: a message re-sent meanwhile lost its bubble for good, and action cards (HQ booking) vanished. The reload keeps what the app holds itself (`keepLocal`); `dedupe` keeps one entry per id.
- `components/advisor/AdvisorChat.tsx:114` — a message that did not go returns to the field without dropping text that reached the field meanwhile; a failed PDF read also returns the typed question (it was lost).
- `components/advisor/AdvisorChat.tsx:41,155–160` — (proposal 2) the app-action check ran for up to 60 s before the message showed. A `Promise.race` with an 8-second timer gives it up and the advisor answers as usual; `api/advisor.ts` is untouched.
- `components/advisor/AdvisorChat.tsx:294` — (proposal 3) a reply arriving while the member reads older messages no longer pulls them to the bottom: new content scrolls into view only when they are at the newest message; their own send always does (line 183).
- `components/advisor/AdvisorChat.tsx:301` — when the keyboard opens (or the field grows) the list shrinks from below and the newest message ended up hidden behind the composer; it stays in view when the member was at the bottom.
- `components/advisor/AdvisorChat.tsx:318` — (proposal 8) dragging the list closes the keyboard.

Composer
- `components/advisor/Composer.tsx:81` — (proposal 1) the field is no longer locked during a send (`editable={!busy}` removed), so the keyboard stays open after each message on iOS; `canSend` still blocks a second send.
- `components/advisor/Composer.tsx:65–69` — the file limit is told before a file is picked: `advisor.file.hint` sits above the field where the picked file's chip then appears. Shown only on binaries that have the picker.
- `components/advisor/Composer.tsx:110` — the send arrow was mirrored in English mode too (it pointed left on a left-to-right screen). Mirrored only in Arabic.
- `components/advisor/Composer.tsx:34` — a voice transcript overwrote the field with the text it held when the recording was stopped (stale `value`). It joins the field's current text.
- `components/advisor/Composer.tsx:39` — starting to record silences a playing voice reply: both use one audio session, and the reply was being recorded into the question.
- `components/advisor/Composer.tsx:54` and `MessageBubble.tsx:146` — an Arabic file name was forced left-to-right (its words read in reverse order); the name follows its own letters (`textDir`).
- `components/advisor/Composer.tsx:57` — a file with no reported size showed «1 KB»; the size label hides instead.
- `components/advisor/Composer.tsx:59`, `AdvisorChat.tsx:335,464` — remove-file, clear-context and close-gate targets were 34–36 pt; 44–46 pt through `hitSlop` (no visual change).

Voice (M104 / M148)
- `components/advisor/VoiceButton.tsx:133,163,165` — the advisor tab stays mounted when the member leaves it, so a recording kept running on other screens and in the background. A blur, or the app leaving the foreground, discards the recording and releases the microphone.
- `components/advisor/AdvisorChat.tsx:90` — same cause for playback: «leaving the chat silences a playing reply» only ran on unmount; it runs on blur.
- `components/advisor/VoiceButton.tsx:92–95` — the refusal alert has a second button, `advisor.voiceOpenSettings`, that calls `Linking.openSettings()` (the first is `common.close`).
- `components/advisor/VoiceButton.tsx:106` — a failure to start (microphone held by a call, audio session refused, the permission call rejecting) was an unhandled rejection with no message. Now an alert with `advisor.voiceStartFailed`, and the audio mode is reset.
- `components/advisor/VoiceButton.tsx:179` — a recording could not be stopped once the composer went busy, and a fast double tap could start two recordings. Both guarded.
- `components/advisor/VoiceButton.tsx:29,173` — (proposal 6) a recording nobody stops ends at 3 minutes and is transcribed (the server refuses past about 6).
- `components/advisor/speech.ts:18,56` — (proposal 5) a voice reply longer than 4000 characters failed with the server's validation error; it is read up to 4000.
- `components/advisor/MessageBubble.tsx:168` — the speaker button was 30 pt; 44 pt through `hitSlop`.

Files (M151)
- `components/advisor/AdvisorChat.tsx:137` — a PDF from cloud storage can arrive with no size, so the 10 MB check passed and the upload failed late with a server error. The bytes actually read are checked before sending (`advisor.file.tooBig`).

Message rendering
- `components/advisor/RichText.tsx:31–35,78,156` — marks the app does not draw no longer reach the member: `` `code` `` and code fences (``` and ~~~, with or without a language) show as plain text with the marks removed, `***bold italic***` shows bold, `*italic*` shows as plain text. Text inside a fence is shown as it is (no heading, list or table is read in it). «5 * 3 * 2» and `a*b*c` keep their stars. The member's own bubble is untouched: their stars and backticks stay as typed. Bold, lists, tables and links are as before.
- `components/advisor/RichText.tsx:186` — (proposal 4) a long press selects and copies a message (`selectable`); table cells are left out so a wide table scrolls freely.
- `components/advisor/RichText.tsx:18` — wrong direction: an all-English reply in the Arabic app sat on the right edge, an Arabic reply in the English app on the left. Text sits on the side of its own script (the M177 rule, `textDir`); each line keeps its own direction.
- `components/advisor/RichText.tsx:10` — a link followed by an Arabic comma, semicolon or question mark swallowed it into the URL and opened a broken page.
- `components/advisor/MessageBubble.tsx:180,182,218` — action pills: `numberOfLines={1}` with shrink and a width cap; 44 pt target through `hitSlop`.
- `components/advisor/MessageBubble.tsx:56` — the attached image goes through `sized()`.

Entry points
- `components/advisor/context.ts:164` — (proposal 7) the neutral portal showed the INVESTOR starter questions until the home content loaded, and for good when it failed. It falls back to the general list (`screen.home`).

## Problems not fixed

Held by the coordinator (not now)
- **Medium — iOS keyboard offset, needs the iPhone.** `AdvisorChat.tsx:254` passes `keyboardVerticalOffset = 49 + bottom inset`. By React Native's formula (`frame bottom − (keyboard top − offset)`), with the tab bar in normal flow, that adds the tab bar's height twice: the composer would float about 83 pt above the keyboard on an iPhone with a home indicator. Unchanged since M4. Proposal: if an empty band the height of the tab bar sits between the composer and the keyboard, set the offset to `0`.
- **Medium — a failed message is not kept in the thread with a retry button.** It leaves the thread, an error notice shows, and the text returns to the field. Proposal: keep the bubble marked as failed with «إعادة الإرسال».
- **Low — possible duplicate after a failed send.** When the server stored the message but the request failed, the reload shows it in the thread while the same text is back in the field. Proposal: the server accepts a client message id.
- **Low — action cards are not stored.** An HQ booking card or an «open screen» pill lives until the next full reload or restart (M145 design).

Other
- **Low — to confirm on a device (new behaviour, not testable here):** long-press copy on Android with Arabic text (alignment must hold with `selectable` on); the keyboard staying open through a send on both platforms; the hint line above the field at small widths (one line, `numberOfLines={1}`).
- **Low — hub chips stay Arabic in English mode.** Quick replies inside a hub message come from the hub in Arabic; the welcome chips and the opening already switch. Proposal: none on the app side; the hub would have to send both languages.
- **Low — not verified:** whether back from the advisor returns to the project or news page that opened it (`AskAdvisor.tsx:76` uses `router.navigate`); needs a device.
- **Low — marks still drawn raw:** `_italic_` with underscores, `~~strike~~` and `> quote` (not in the decision; underscores are risky to strip because of names like `snake_case`).
- **Info — a second message can be sent while the advisor is still writing** (the composer is not blocked on `waiting`). Left as designed: staff may be the one replying.

Checked, no problem found
- Balance: the pill says «رصيد اليوم» (never «كريديت»), shows only at a tenth or less of the day's limit, shows 0 at zero; the daily gate then appears on the next send.
- Hard rule 3: the gate and the `membership` action open the in-app `/membership` screen only; payment and membership URLs are stripped by the server (`server/src/advisor/sanitize.ts`), the app adds no link of its own.
- Hard rule 7: the advisor area renders no news; a news item is only a context (type + id).
- Valuation disclaimer: the app adds none to advisor answers; it can only come from the hub prompt.
- Native modules: `ExpoAudio` and `ExpoDocumentPicker` are gated with `requireOptionalNativeModule` before any `require`; binaries without them show no mic, speaker, attach button or file hint. `expo-file-system` is a static import in `speech.ts`, present in every binary (expo-asset depends on it). `Linking.openSettings` is React Native core.
- Voice language: the server passes the app language to the transcription (`server/src/advisor/voice.ts:25`).
- All 150 string keys used by the area (every `advisor.starter.*` and the three new keys included) exist in `ar.json` and `en.json`; no hard-coded member-facing text; no banned words in the advisor strings.
- Every route in `screens.ts` exists under `app/src/app`. The video, news, post and service id patterns in `context.ts` match the server's (`server/src/advisor/routes.ts:28–34`). Message length (4000) and file size (10 MB) match the server's limits.
- Android: `tabBarHideOnKeyboard` is set for Android in `(tabs)/_layout.tsx:90`, so the bar leaves when the keyboard opens.
- Colours: all from tokens through `themedStyles`, except two translucent overlays on the member's gold file chip (`MessageBubble.tsx:203`, black 18% border and white 22% fill over the gold gradient — identical in both themes, so not a light-mode defect).

## Shared-file changes needed

None. The three keys (`advisor.voiceOpenSettings`, `advisor.voiceStartFailed`, `advisor.file.hint`) are already in both tables; `api/advisor.ts`, `ar.json`, `en.json` and `tokens.ts` were not edited.

## Checks run

- `npx tsc --noEmit` (in `app/`) — exit 0 after round 2, with the other sessions' edits in the tree at that moment.
- `npx eslint "src/app/(tabs)/advisor.tsx" src/components/advisor` — exit 0, no warnings, after round 2.
- Node check of the new markdown patterns read from `RichText.tsx` itself: `*italic*`, `***both***`, `` `code` ``, fences and one-line fences are stripped; «5 * 3 * 2», `a*b*c`, a lone footnote star, `snake_case` and links are left alone; both token patterns keep exactly one capture group (the split relies on it).
- Node check of the string keys: 150 keys, 0 missing in either language.
- Line endings: all changed files still CRLF. Edits were made with the Edit tool only in round 2; no git command changed the tree.
- Not run: Metro, gradle, the emulator, any OTA or build. No request was made to production.

Changed files (8): `AdvisorChat.tsx`, `Composer.tsx`, `MessageBubble.tsx`, `RichText.tsx`, `VoiceButton.tsx`, `context.ts`, `speech.ts`, `useAdvisorChat.ts`. Unchanged: `advisor.tsx`, `AskAdvisor.tsx`, `FileButton.tsx`, `HqProposalCard.tsx`, `screens.ts`.
