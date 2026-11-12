# 07 Moderation and quality

## The moderation queue

| ID | Requirement | Status |
|---|---|---|
| MOD-1 | Escalated questions (ANS-30, ANS-31, ANS-33) must reach a moderation queue with the question (without identifiers), the reason and the time. | Built |
| MOD-2 | Only signed-in moderators may see the queue. Each moderator signs in with their own key (MOD-20); the shared `MODERATOR_TOKEN` still works while it is set, without a profile. | Built |
| MOD-3 | The queue is on the Curate & Moderate page (`/kiosk/curate`), linked from Settings. | Built |
| MOD-4 | A moderator must be able to mark an item handled, with a note, and filter the queue by state (open, handled) and reason. Handling is in the audit log (MOD-25). | Built |

## Reviewing answers

| ID | Requirement | Status |
|---|---|---|
| MOD-10 | A moderator must be able to review answers the kiosk gave, seeing the question, the answer, the sources it cited and the notebook it was asked in. Answers reach the review list only when someone asks: each answer in the kiosk has "Ask a moderator to check this answer", for visitors and for moderators testing the kiosk. The cited sources are read from the answer's sources line by the server, never taken from the client. | Built |
| MOD-14 | Reviewing answers from the server's conversations, or from a notebook shared with the moderators, without a visitor sending them. | Planned |
| MOD-11 | For each answer the moderator must be able to: rate it (*correct*, *partly correct*, *incorrect*, *should have declined*); mark each cited source as *relevant* or *not relevant*; add the sources that should have been cited (missing references), from the knowledge base, the notebook, or a web address; and add context (a note explaining the right answer). Every cited source must be marked before a review is saved. | Built |
| MOD-12 | Added context and references must become knowledge: a moderator may promote them to a new or improved curated Q&A entry (with its category and red-flag marker), which then goes through the normal approval (KNW-1). Proposals are listed on the quality page as entries for `content/curated_qa.json` with the next free id, for a curator to copy in. | Built (curator adds the entry) |
| MOD-13 | Every review must record who reviewed it and when, and may be changed later by another moderator, keeping the history. The latest review counts towards scores; each review is counted on the moderator's record and in the audit log (rating and counts only). | Built |

## F1 score per notebook

How well the kiosk finds and cites the right sources, measured from moderators' reviews.

For each reviewed answer, using the moderator's marks:

- **true positives (TP)**: cited sources marked relevant;
- **false positives (FP)**: cited sources marked not relevant;
- **false negatives (FN)**: sources the moderator added as missing.

For a notebook, totals are summed over its reviewed answers, then:

- precision = TP / (TP + FP)
- recall = TP / (TP + FN)
- **F1 = 2 × precision × recall / (precision + recall)**

| ID | Requirement | Status |
|---|---|---|
| MOD-30 | The kiosk must compute precision, recall and F1 for each notebook from its reviewed answers, as defined above, together with the share of answers rated correct (answer accuracy), so source quality and answer quality are both visible. | Built |
| MOD-31 | A score must show how many answers it is based on, and must not be shown as a number with fewer than 5 reviewed answers ("not enough reviews yet"). | Built |
| MOD-32 | An answer that correctly said "not covered" (rated correct, no sources cited, none missing) counts towards accuracy but not towards F1. | Built |
| MOD-33 | **F1 dashboard**: one page listing notebooks with their F1, precision, recall, accuracy and number of reviews, sortable, with each notebook's score over time (by week) and its worst-scoring answers to review first. The curated knowledge base appears as its own row: every answer that cited or should have cited a curated source, or was asked with no notebook, counting curated sources only. The page is `/kiosk/quality`; weeks run Monday to Sunday (UTC) by when the answer was given, and a period (4, 12 or 52 weeks) may be chosen. | Built |
| MOD-34 | Scores must be computable offline and reproducible: the same reviews always give the same numbers (tested). | Built |

Check: `packages/yaxb-core/test/reviews.test.ts` (the worked example, fewer than 5 reviews, "not covered", reproducibility, memory and D1 stores); a demonstration of sending an answer from the kiosk, reviewing it and seeing it on the quality page.

## Moderators and their keys

| ID | Requirement | Status |
|---|---|---|
| MOD-20 | The organisation (YAXB administrator) must be able to issue a moderator key: a random secret shown once when it is created, stored only as a hash, with the moderator's name, an optional expiry and a label. | Built |
| MOD-21 | A moderator must sign in with their key. Signing in starts a session (a signed cookie); the key itself is never stored in the browser. | Built |
| MOD-22 | The administrator must have a Moderators page: list moderators with their status (active, expired, revoked), last sign-in and number of reviews; issue a key; revoke a key; rotate a key (issue a new one and revoke the old). | Built |
| MOD-23 | Only the administrator may manage moderators, signed in with the administrator secret (a deployment secret, not a moderator key). | Built |
| MOD-24 | Each moderator must have a profile page like a visitor's (06): display name, languages, the knowledge sources they look after, preferences, and their own activity log (reviews done, items handled, sign-ins), never the content of what they reviewed. Unlike a visitor's, it is kept on the server, because moderators work from several devices. | Built |
| MOD-25 | Every review, handled item and key change must be recorded in an audit log the administrator can read: who, what, when, metadata only. | Built |

## Feedback

| ID | Requirement | Status |
|---|---|---|
| MOD-40 | Moderators must see session feedback (FBK): counts of Bad, Fine and Good by day and by answer mode, and the comments. | Built |
