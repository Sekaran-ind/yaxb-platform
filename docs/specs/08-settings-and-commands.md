# 08 Settings and kiosk commands

## Settings

Settings are kept in the browser and sent with each question; nothing in them is secret.

| ID | Requirement | Status |
|---|---|---|
| SET-1 | **Model**: provider and model from the organisation's allowlist (only configured providers selectable), and creativity (temperature) where the model allows it. | Built |
| SET-2 | **Agent**: harness (automatic, deep, lean) and helpers (knowledge researcher, safety reviewer). | Built |
| SET-3 | **Knowledge**: answer mode (02), sentence-transformer (KNW-31), web search fallback (KNW-43), on-device search for the agent. | Built |
| SET-4 | **Language** (04). | Built |
| SET-5 | **Tools**: knowledge search, knowledge sources, file tools, planning; escalation is always on and shown as locked. | Built |
| SET-6 | **MCP servers**: only those the organisation configured. | Built |
| SET-7 | **Memory and skills**: notebook memory on or off; each skill on or off. | Built |
| SET-8 | **Storage**: this browser, this session only, a local box, or the server (09). | Built |
| SET-9 | **Layout and voice**: automatic, mini, pod or full layout; read-aloud, voice for the chosen language, speaking rate. | Built |

## Layouts

| ID | Requirement | Status |
|---|---|---|
| LAY-1 | Three layouts from one screen configuration: *mini* (a compact card, one screen at a time), *pod* (a player strip with screens below) and *full* (the console beside the screens). *Automatic* picks by available width and can grow back out of mini. | Built |
| LAY-2 | Navigation adapts: tabs, sidebar, accordion or panes, with a compact menu under 768 px. | Built |

## The kiosk understanding its own commands

A visitor should be able to ask the kiosk to do things to itself, in their own words and language, as well as asking questions.

| ID | Requirement | Status |
|---|---|---|
| CMD-1 | The kiosk must recognise requests about itself and act on them: open a screen ("open the model settings", "show my notebook", "go to services"); change a setting ("speak slower", "switch to Tamil", "turn off web search", "use the simple layout"); start a journey ("I want to check in"); manage the profile ("update my profile", "sign me out"). | Built |
| CMD-2 | It must answer questions about itself from its own definitions, so the answers are always current: "what can you do?", "what languages do you speak?", "where do your answers come from?", "what is on-device mode?". This uses the journey summaries (JRN-21), the settings catalogue and these specifications' visitor-facing parts. | Built |
| CMD-3 | Commands must be recognised by meaning (the sentence-transformer, in any kiosk language) against a catalogue of commands, each with a description and examples; when the AI agent is in use, it may also call a `kiosk_command` tool restricted to the same catalogue. | Built (on-device recognition; the optional agent tool is not needed, since commands are handled before the agent sees them) |
| CMD-4 | A command that changes something must show what it will do and ask for confirmation ("Turn off web search? Yes / No") unless it only opens a screen. Commands that need a profile ask the visitor to sign in first. | Built |
| CMD-5 | Commands must never do anything the Settings screen can't: no new capabilities, no access to keys, no change to safety rules (escalation stays on). | Built |
| CMD-6 | Commands that the visitor can't use (for example administrator actions) must be refused with an explanation. | Built |
| CMD-10 | **Profile by conversation**: "update my profile with more detailed answers" (or a longer description of how they like to be helped) must be read into the profile's fields with the slot-filling of JRN-13 and JRN-14, shown as a change for confirmation, and saved only when confirmed. | Built |
| CMD-11 | Every command carried out is recorded in the activity log when a profile is open (ACT). | Built |

Check: a test catalogue of phrasings per command in English and in Tamil, each recognised as the right command and none of a set of ordinary questions recognised as a command.
