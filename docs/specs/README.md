# YAXB Kiosk: requirements specifications

These documents describe what the YAXB kiosk must do, for the people who decide what it does and the people who build and test it. They state requirements and how to check them, not how the code is organised; for that, see [CLAUDE.md](../../CLAUDE.md) and the package READMEs.

| # | Specification | Covers |
|---|---|---|
| 01 | [Overview](01-overview.md) | Purpose, who uses the kiosk, principles, surfaces |
| 02 | [Conversation and answers](02-conversation-and-answers.md) | Asking, answer modes, grounding and citations, safety, escalation |
| 03 | [Knowledge](03-knowledge.md) | Curated Q&A, notebooks, websites, on-device search, web fallback, tool routing |
| 04 | [Languages and voice](04-languages-and-voice.md) | The language picker, speech in and out, translation |
| 05 | [Journeys and forms](05-journeys-and-forms.md) | Guided services, slot filling, journey summaries |
| 06 | [Profiles, activity and feedback](06-profiles-activity-feedback.md) | Visitor profiles, suggested settings, the activity log, session feedback |
| 07 | [Moderation and quality](07-moderation-and-quality.md) | The moderation queue, moderators and their keys, rating answers, F1 per notebook |
| 08 | [Settings and kiosk commands](08-settings-and-commands.md) | Settings, layouts, and the kiosk understanding its own commands |
| 09 | [Privacy, storage and security](09-privacy-storage-security.md) | What is kept where, what never leaves the device, protections |
| 10 | [Platforms](10-platforms.md) | Web, native app, CLI, local box, voice device |

## Conventions

**Requirement IDs.** Each requirement has an ID such as `ANS-4`: a prefix for the area and a number. IDs are never reused; a dropped requirement is marked *Withdrawn*.

**Strength.** *Must* is required for the feature to be accepted. *Should* is expected unless there's a stated reason not to. *May* is optional.

**Status.** Every requirement is one of:

- **Built**: in the code, with automated tests where the behaviour can be tested without a person.
- **Planned**: agreed and not yet built. Planned requirements are the brief for the work.
- **Proposed**: a suggested answer to an open question, to be confirmed.

**Acceptance.** "Check:" lines say how a reviewer can confirm a requirement, by a test, a demonstration, or a review.

## Roles

| Role | Who | Signs in with |
|---|---|---|
| Visitor | Anyone at the kiosk | Nothing, or their device-local profile (06) |
| Moderator | A person who reviews escalated questions and rates answers | A moderator key (07) |
| Administrator | The organisation running the kiosk (YAXB) | Deployment secrets; issues moderator keys (07) |

## Glossary

- **Knowledge base**: the curated Q&A, approved by moderators, that ships with the kiosk.
- **Notebook**: the visitor's own collection of sources (documents, and websites once KNW-20 is built) with a memory, which the assistant can read and cite.
- **Grounded answer**: an answer whose every fact comes from a cited source.
- **Sentence-transformer**: a small model that turns text into vectors, so questions can be matched by meaning, in any of the kiosk's languages.
- **Journey**: a guided service made of steps (questions, on-device models, the assistant), defined in YAML.
- **Escalation**: sending a question to the human moderators.
