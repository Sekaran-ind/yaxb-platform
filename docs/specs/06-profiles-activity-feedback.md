# 06 Profiles, activity and feedback

## Visitor profiles

A profile lets the kiosk set itself up for a visitor. It follows clinux-diary's first run: a privacy notice, a little about the person, then a passphrase that encrypts everything on the device.

| ID | Requirement | Status |
|---|---|---|
| PRF-1 | Creating a profile must take these steps: the privacy notice (accepted to continue); about you (nickname required; age range, language and city optional); interests; how you like to be helped; a passphrase of at least 8 characters, entered twice. | Built |
| PRF-2 | A profile must hold only that: never ID numbers, a date of birth, health details or anything else. | Built |
| PRF-3 | A profile must live on the device, encrypted with the passphrase (PBKDF2-SHA256, 600,000 iterations, AES-GCM 256). Only the nickname is stored unencrypted, so it can be picked from a list. There is no server account, and no recovery without the passphrase. | Built |
| PRF-4 | Interest areas: health topics, medicines and pharmacy, food and nutrition, reports and test results, visits and appointments, my own documents, workplace policies, translation. | Built |
| PRF-5 | "How you like to be helped" asks five questions: answer depth (short or detailed), channel (voice, text, both), where answers come from (device only, the assistant, the assistant and the web), comfort with technology, and a second check for health answers. All optional. | Built |
| PRF-6 | A shared kiosk must sign a profile out after 10 minutes without a touch or key press, and on sign-out restore the kiosk's own settings for the next visitor. | Built |
| PRF-7 | A visitor must be able to edit their answers, change the passphrase, export the profile and its activity log as a file, sign out, and erase the profile (confirmed by typing the nickname). | Built |
| PRF-8 | A visitor should be able to update the profile by talking to the kiosk ("update my profile: I prefer detailed answers"), with the changes shown for confirmation before they are saved (CMD-10). | Built |

## Suggested settings

| ID | Requirement | Status |
|---|---|---|
| PRF-20 | From the profile, the kiosk must suggest settings, each with the answer that led to it: the answer mode and web search; short or detailed answers (skills and helpers); the safety reviewer; voice on or off; the layout and speaking rate; notebook tools; and which services appear first under "For you". | Built |
| PRF-21 | Suggestions change nothing until the visitor applies them, and can be undone. Applied suggestions return when the visitor signs in again. | Built |
| PRF-22 | Suggestions must only name tools, helpers, skills and services the kiosk actually has. | Built |

## Activity log

| ID | Requirement | Status |
|---|---|---|
| ACT-1 | While a profile is open, the kiosk must record what happened on it: profile created, signed in or out (and automatic sign-out), profile changed, passphrase changed, exported, suggestions applied or undone, question asked (and how it was answered), web searched, question escalated, journey completed, notebook source added or removed, notebook memory changed. | Built |
| ACT-2 | The log must never contain what the visitor said or wrote: only the action, the time and a few short facts from a fixed list (mode, language, journey id, counts). | Built |
| ACT-3 | The log must be shown newest first, with relative times ("5 minutes ago") and the exact time on hover, in pages of 25. It is kept encrypted with the profile, up to 500 entries. | Built |
| ACT-4 | Nothing is logged while no profile is open. | Built |

## Session feedback

| ID | Requirement | Status |
|---|---|---|
| FBK-1 | Once in a while, the kiosk must ask "How is YAXB doing this session?" with three answers: *Bad*, *Fine* and *Good*, and an optional short comment. | Built |
| FBK-2 | It must ask at most once per session, only after the visitor has had at least one answer, never during a journey, an emergency answer or while speaking, and at random (by default about one session in three). Dismissing it counts as an answer of "skipped" and it won't ask again that session. | Built |
| FBK-3 | Feedback must be stored without identifying the visitor: the rating, the comment if given, the time, the answer mode, language and whether a profile was open. Never the conversation. | Built |
| FBK-4 | Feedback must be sent to the server so moderators can see totals and trends (MOD-40), and recorded in the activity log when a profile is open. Offline, it waits and is sent later. | Built |
| FBK-5 | The frequency must be settable by the organisation, including off. | Built |

## Child safety lock

| ID | Requirement | Status |
|---|---|---|
| CHL-1 | A parent can turn on the child safety lock (Preferences → Child safety lock) with a PIN of 4 to 8 digits, typed twice and kept only as a hash. A profile whose age range is Under 18 is in child mode while it is open, without a PIN. | Built |
| CHL-2 | In child mode the kiosk never searches the web and uses no outside (MCP) tools; the server enforces both from the turn's settings. Kiosk only's web answers are off too. | Built |
| CHL-3 | The assistant answers for a child: short, kind and simple; no adult themes or harmful instructions; it never asks for or repeats personal details; a child who seems unsafe is told to tell a trusted adult, given the emergency number, and the conversation is flagged to the moderators. | Built |
| CHL-4 | Websites added to a notebook still pass the family-safe DNS filter (KNW-25). | Built |
| CHL-5 | The staff sections, the Service Catalogue (its page, its navbar link) and the AI designer are hidden; their addresses lead back to Quick tools. | Built |
| CHL-6 | Preferences keep only Profile, Language, Layout, theme and voice, and the lock itself; the model, knowledge, tools, storage and front desk need the PIN. | Built |
| CHL-7 | Commands can't change where answers come from or web search while the lock is on. | Built |
| CHL-8 | A "Child lock" pill beside Preferences shows the lock is on and opens its section; only the parent's PIN turns the device lock off (a wrong PIN is refused). | Built |
