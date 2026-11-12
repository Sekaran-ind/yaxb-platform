# 07 Moderation and quality

## The moderation queue

| ID | Requirement | Status |
|---|---|---|
| MOD-1 | Escalated questions (ANS-30, ANS-31, ANS-33) must reach a moderation queue with the question (without identifiers), the reason and the time. | Built |
| MOD-2 | Only signed-in moderators may see the queue. Today moderators sign in with one shared token (`MODERATOR_TOKEN`); MOD-20 replaces it with a key per moderator. | Built (shared token) |
| MOD-3 | The queue is on the Curate & Moderate page (`/kiosk/curate`), linked from Settings. | Built |
| MOD-4 | A moderator must be able to mark an item handled, with a note, and filter the queue by state (open, handled) and reason. | Planned |

## Reviewing answers

| ID | Requirement | Status |
|---|---|---|
| MOD-10 | A moderator must be able to review any answer the kiosk gave in a notebook they have been given (a shared or exported notebook) or in the server's conversations, seeing the question, the answer and the sources it cited. | Planned |
| MOD-11 | For each answer the moderator must be able to: rate it (*correct*, *partly correct*, *incorrect*, *should have declined*); mark each cited source as *relevant* or *not relevant*; add the sources that should have been cited (missing references), from the knowledge base, the notebook, or a web address; and add context (a note explaining the right answer). | Planned |
| MOD-12 | Added context and references must become knowledge: a moderator may promote them to a new or improved curated Q&A entry (with its category and red-flag marker), which then goes through the normal approval (KNW-1). | Planned |
| MOD-13 | Every review must record who reviewed it and when, and may be changed later by another moderator, keeping the history. | Planned |

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
| MOD-30 | The kiosk must compute precision, recall and F1 for each notebook from its reviewed answers, as defined above, together with the share of answers rated correct (answer accuracy), so source quality and answer quality are both visible. | Planned |
| MOD-31 | A score must show how many answers it is based on, and must not be shown as a number with fewer than 5 reviewed answers ("not enough reviews yet"). | Planned |
| MOD-32 | An answer that correctly said "not covered" (rated correct, no sources cited, none missing) counts towards accuracy but not towards F1. | Proposed |
| MOD-33 | **F1 dashboard**: one page listing notebooks with their F1, precision, recall, accuracy and number of reviews, sortable, with each notebook's score over time (by week) and its worst-scoring answers to review first. The curated knowledge base appears as its own row. | Planned |
| MOD-34 | Scores must be computable offline and reproducible: the same reviews always give the same numbers (tested). | Planned |

## Moderators and their keys

| ID | Requirement | Status |
|---|---|---|
| MOD-20 | The organisation (YAXB administrator) must be able to issue a moderator key: a random secret shown once when it is created, stored only as a hash, with the moderator's name, an optional expiry and a label. | Planned |
| MOD-21 | A moderator must sign in with their key. Signing in starts a session (a signed cookie); the key itself is never stored in the browser. | Planned |
| MOD-22 | The administrator must have a Moderators page: list moderators with their status (active, expired, revoked), last sign-in and number of reviews; issue a key; revoke a key; rotate a key (issue a new one and revoke the old). | Planned |
| MOD-23 | Only the administrator may manage moderators, signed in with the administrator secret (a deployment secret, not a moderator key). | Planned |
| MOD-24 | Each moderator must have a profile page like a visitor's (06): display name, languages, the knowledge sources they look after, preferences, and their own activity log (reviews done, items handled, sign-ins), never the content of what they reviewed. Unlike a visitor's, it is kept on the server, because moderators work from several devices. | Planned |
| MOD-25 | Every review, handled item and key change must be recorded in an audit log the administrator can read: who, what, when, metadata only. | Planned |

## Feedback

| ID | Requirement | Status |
|---|---|---|
| MOD-40 | Moderators must see session feedback (FBK): counts of Bad, Fine and Good by day and by answer mode, and the comments. | Built |
