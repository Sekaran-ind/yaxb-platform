# Profiles, child lock and feedback

Part of the architecture notes for Claude Code; the index is in [CLAUDE.md](../../CLAUDE.md).

## Profiles and the activity log

- **Core** (`accounts/`, after clinux-diary's first run and Account panel):
  - `profileSchema` holds a nickname, an age range, the language, an optional city, `INTEREST_DOMAINS` and the `PERSONALITY_QUESTIONS` answers. Never ID numbers, a date of birth or health details.
  - `preferencesFrom(profile)` gives agent settings, kiosk settings (voice, layout, speech rate), the services to `highlight`, and `suggestions`, each with its `because`. `applyPreferences` merges them into the current settings.
  - `activityEvent` allows only known actions (`ACTIVITY_ACTIONS`), and details only from a short list of keys. It never carries content.
  - `accounts/crypto.ts` is the diary's PBKDF2 (600k iterations) → AES-GCM vault: the nickname is in the clear, everything else sealed.
- **Web:**
  - `composables/account.ts` is a singleton with an IndexedDB store `yaxb-accounts` (memory if unavailable). It auto-locks after 10 idle minutes.
  - On sign-out it restores the settings from before "apply suggestions"; on sign-in it re-applies them.
  - `logActivity()` does nothing while no profile is open. It is called by chat turns (`question.asked`, `web.searched`, `question.escalated`), journeys (`journey.completed`) and the notebook composable.
  - UI: `components/account/` (`AccountScreen` sign-in, `AccountSetup` the diary-style steps, `AccountPanel` suggestions, activity log, passphrase, export, erase), the `account` screen in `screens.yaml`, the header chip, and the "For you" section on Services.

## Child safety lock (CHL-1..8)

- Core: `agentSettings.child` (schemas); with it `ask()` never searches the web or loads MCP tools, and `turnPromptAddendum` adds `CHILD_RULES` (prompts.ts).
- Web: `composables/child.ts` (`useChildMode().on`: `settings.child.on` whatever space is open, a parent's PIN hashed with the prefix `yaxb-child:`, or an open profile with `ageRange: "under-18"` where profiles are offered; `enableChildLock`, `disableChildLock`; SPC-9: `settings.child.spaces`, `childSpacesOf`, `setChildSpaces`, used by `useIdentity().spacesHere`/`childMode` so the picker, the player and the your-account journey offer only those family spaces, KioskShell closes any other open space, and starting, joining, making an account and Google are refused). `KioskShell` sends `child: true`, `mcp: []`, web off, skips Kiosk only's web answers and refuses knowledge changes by command; `ServicesScreen`, `ContextSheet`, `/staff`, the navbar and the router hide staff sections and the catalogue; Preferences shows only profile, language, kiosk and `child` (`ChildLockSetup.vue`); `AskMePills` shows a Child lock pill.

## Session feedback

- `feedback/` (core): `feedbackSchema` holds the rating (bad, fine, good or skipped), an optional comment, the mode, language, whether a profile was open, and the answer count. Nothing else. `shouldAskFeedback` (FBK-2), `summarizeFeedback` (MOD-40), `FeedbackStore` (memory, plus D1 `createD1FeedbackStore`, migration 0003). `FEEDBACK_RATE` (0 to 1, default 1/3) is in capabilities.
- Worker: `POST /api/feedback` (same origin, session, form rate limit); `GET /api/agent/feedback` for moderators only.
- Web: `composables/feedback.ts` draws once per browser session (sessionStorage) and queues in localStorage when offline. `FeedbackPrompt.vue` sits under the kiosk header, and `consider()` runs after each answer and its read-aloud. Totals and comments appear on the Curate page.
