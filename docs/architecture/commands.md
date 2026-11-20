# Kiosk commands

Part of the architecture notes for Claude Code; the index is in [CLAUDE.md](../../CLAUDE.md).

- `commands/` (core):
  - `KIOSK_COMMANDS` (plus `journeyCommands` from content) is the catalogue: id, label, examples in English, Tamil and Hindi, an effect (data: open-screen, open-settings, settings, journey, profile, about, refuse), and `confirm`.
  - `matchCommand(text, { commands, embed, thresholds })` recognises by meaning with `COMMAND_THRESHOLDS` per model (calibrated: MiniLM commands 0.67 and up, questions 0.53 and below), or by words without a model. More than 25 words is always a question.
  - Settings effects may only touch language, `knowledge.answers` and `knowledge.web`, voice, layout and speech rate (a test checks this). Escalation, keys and others' data are refused (`refuse.admin`).
  - `aboutKiosk` answers from definitions (CMD-2). `profileFields` and `profilePatch` support profile by conversation (CMD-10).
  - `PROFILE_FORM` lets `/api/agent/extract` fill the profile form with the model.
  - `test/fixtures/command-embeddings.json` holds real MiniLM vectors for every catalogue example. Regenerate it when the catalogue changes; the test names the missing example.
- Web:
  - `lib/browser/commands.ts` `recognizeCommand` runs before any answering in `KioskShell.ask()`, in every answer mode.
  - A command becomes a `ChatTurn.card` (`CommandCard` in `lib/types.ts`) rendered by `CommandCard.vue`: an AI-cover header, then content (changes from now to after, a journey summary with Start, the about text, a refusal), then Yes/No.
  - `onCard` carries out the buttons. A spoken "yes" or "no" (several languages, `yesOrNo`) answers a pending card.
  - Settings opens a section from `?section=`.
- Slot filling picks a choice field's option by meaning when it clearly leads (`OPTION_BY_MEANING`).
