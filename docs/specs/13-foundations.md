# 13 Foundations

What the media, connector, identity and email features (14, 15, 16) and every edition (12) build on: spell check, maps, charts and timelines, the organisation design, a shared vocabulary, storage housekeeping and statutory retention, audit, the Ethics Counsellor, the player, and answers about each service without a model.

Source: *Anjal: Media, FaceOps, Connectors and Routines* and *Anjal Family and Community Editions* (2026-11-16), reviewed on 2026-11-18.

## Spell check for typed questions

Embeddings forgive small typos, but the word-based passes missed them: commands without a model, slot labels and patterns, option matching, Kiosk-only answers. The spell check is yaxb-core `spell` (export `./spell`), run in the browser by `lib/browser/spell.ts`.

| ID | Requirement | Status |
|---|---|---|
| SPL-1 | Typed text must be normalised before matching: Unicode NFC, spacing, and Indian-script digits turned into ASCII digits. | Built |
| SPL-2 | Words are corrected by SymSpell-style lookup (edit distance up to 2) over grapheme clusters (`Intl.Segmenter`), so a Tamil or Hindi letter with its vowel sign counts as one letter. Split and joined words ("check in", "checkin") are also tried. | Built |
| SPL-3 | Commands, search and slot filling must run on both the original and the corrected text and keep the better score. The original is never overwritten. | Built |
| SPL-4 | Words are corrected against a dictionary per tenant and language. It is built from that tenant's own words (curated Q&A, notebook text, command examples, service, journey, screen and field titles, field options, unit and role names), with a general word list per language weighted lower. The core's part is built at content-build time; the tenant's part when its services or notebooks change. | Built: corrections land only on the kiosk's and tenant's own words, and the general list (a short hand-made one for English, Tamil and Hindi in `spell/general.ts`) only marks words as real. The core's part is gathered from the bundled content on first use (about 160 ms). A fuller general list per language is open. |
| SPL-5 | Numbers, money, phone numbers, email and web addresses, ids, names found by the NER model and password fields are never corrected. Spoken input is not spell-checked. | Built |
| SPL-6 | When the corrected text finds a strong match that the original did not, Anjal acts on it and says so ("Showing results for *check in*. Search for *chek in* instead?"). When both matches are weak, it shows a "Did you mean…" chip and does nothing. | Built |
| SPL-7 | The AI agent gets the original text, with the correction as a hint. | Built |
| SPL-8 | Romanised Tamil and Hindi ("enaku leave venum") should be transliterated to the native script before matching when the kiosk language is Tamil or Hindi. This may need the box rather than the browser. | Planned |
| SPL-9 | Elders' text gets a gentler setting: always suggest, never act on a correction without a tap. | Planned |
| SPL-10 | A `spell.corrected` event records the language and whether the person accepted the correction, never the words. A test set of mistyped questions in English, Tamil and Hindi must show matches going up, with wrong corrections under 2%. | Built: the activity log's `spell.corrected` (language, `via`, `accepted`). `test/fixtures/spell-typos.json`: English 20 of 24 recovered, Tamil 6 of 6, Hindi 6 of 6; word-matched commands 0 → 8 of 9; no changes to 258 words of correct text. |
| SPL-11 | Vocabularies are maintained, not hard-coded. A **Vocabulary** tool, which a kiosk can include like any other tool, lets staff add, edit and remove words and phrases at two levels: the kiosk's (its place names, people's titles, local words) and each service's (words unique to that service, kept with the service in the catalogue). Entries may be in any language and script, and each records its language. | Planned |
| SPL-12 | A service's vocabulary travels with the service: it is part of the service's definition in the catalogue, so a kiosk that loads the service gets its words, and removing the service removes them. | Planned |
| SPL-13 | An entry may be a word, a phrase that should stay together ("check in"), or a known misspelling with its correction ("cheq" → "check"). The spell check uses the kiosk vocabulary, then the loaded services' vocabularies, then the general list. | Planned |
| SPL-14 | The hand-made general list (`spell/general.ts`) is a stop-gap. It is replaced by a general list per language from a maintained, openly licensed source, chosen with the user, loaded on demand per language rather than bundled. | Planned |

## Maps, charts and timelines

| ID | Requirement | Status |
|---|---|---|
| VIS-1 | Maps use Leaflet with OpenStreetMap, moved into YAxb from clinux-core (`MapView`, `GeoPicker`). For real traffic, tiles come from a provider or a PMTiles file on R2 or the box, which also works offline. Google Maps or Mappls are optional connectors with the business's own key, never the default. | Partly built (2026-11-20): Leaflet with OpenStreetMap tiles, moved from clinux-core into yaxb-journeys/vue (`MapView`, `GeoPicker`, circle markers and a CSS pin, no marker images); a provider's tiles through the host (`VITE_TILE_URL`, `TILE_ORIGIN` in the CSP). PMTiles on R2 or the box, and Google Maps or Mappls connectors, are open |
| VIS-2 | Place search goes through the Worker to Nominatim, cached per tenant and kept within its usage limits. Distances, "inside this area" and the nearest site use Turf.js on the device. | Built (2026-11-20): `GET /api/places/search` goes to Nominatim (or `PLACES_URL`), cached per edition and business for a week, one request a second per isolate, a generic client name and only the words searched; yaxb-journeys `geo.ts` measures distances, "inside this area" and the nearest site with Turf.js on the device |
| VIS-3 | Dashboards use Observable Plot, themed with the existing tokens so every theme works. No hand-drawn bars are left in the service dashboards. | Built (2026-11-20): `PlotChart` (yaxb-journeys/vue, Observable Plot) draws bars or a line themed from the `--yj-*` tokens, redrawn when the theme or width changes, with the numbers in a table for screen readers; the service dashboard's weeks and funnels use it, and no hand-drawn bars are left |
| VIS-4 | An `EventTimeline` component (d3-scale, d3-zoom): horizontal scroll and zoom, lanes, and a vertical list on narrow screens. Timeline items are schema.org Events built from case events, Scheduler items and dated notebook sources. TimelineJS is used only for story-style pages such as the family journal. | Partly built (2026-11-20): `EventTimeline` (d3-scale, d3-zoom: wheel, drag, pinch and buttons; a lane per kind; a list by day on narrow screens or by choice) over schema.org Events from core `timeline` (`occurrenceEvents`, `caseTimeline`, `sourceEvents`): the Scheduler's Timeline view, a request's thread "On a timeline", and the notebook's sources. TimelineJS for story pages (the family journal, EDN-41) is open |
| VIS-5 | Two new field types: `location` (a point, picked or from the device) and `area` (a drawn region), stored as schema.org GeoCoordinates and GeoShape. | Built (2026-11-20): field types `location` (schema.org GeoCoordinates: tap, drag, search, or the device's position when asked) and `area` (a GeoShape drawn by tapping its corners); summaries round a place to about 100 m; slot filling and the agent skip them; the guardian counts them as location |
| VIS-6 | Three display blocks a screen or result can show: `map`, `timeline` and `chart`. | Built (2026-11-20): `show: [{ map \| chart \| timeline: { from, title, kind } }]` on a question screen or a result (journeys and nested screens, checked by `journeyProblems`, kept by the designer as `showYaml`); the runner fills `data` from the template into `RunState.prompt.show` and `result.show`, and `DisplayBlocks` renders them in `JourneyRunner` and the kiosk's `JourneyPanel`; the designer agent knows the key |
| VIS-7 | The components live in yaxb-journeys/vue (or a separate yaxb-visual package if they grow too heavy), each lazy-loaded as its own chunk, like the YAML editor. | Built (2026-11-20): `GeoPicker`, `MapView`, `PlotChart` and `EventTimeline` live in yaxb-journeys/vue, each its own lazy chunk, with Leaflet, Turf, Observable Plot and d3 external in the library build |
| VIS-8 | The device's position is asked for only when a field needs it, behind consent, and is never tracked continuously. A check-in may store only "inside site X". The child lock turns location off. | Built (2026-11-20): the device's position is asked for only when a person taps "Use my location" on a place field, once (never watched); the child lock hides it (`GeoHost.locate`). Attendance's check-in already keeps only "inside site X" (ATT-6) |

## The organisation design

Today a business has a flat list of roles, so "approve by the requester's manager" can't be expressed.

| ID | Requirement | Status |
|---|---|---|
| ORG-1 | A `kind: organisation` document, published through the Service Catalogue like a service, holds units (departments), their roles, `reports_to`, the services each unit runs, and sites. | Built: a `kind: organisation` catalogue entry (yaxb-journeys `organisation.ts`, `compileOrganisation`): units with `lead`, `roles` (a role belongs to one unit), `reports_to`, `services` and `sites`; one per catalogue, administrators only, reviewed and published like a service (migration 0016). The catalogue's Organisation screen and the workspace's Organisation view. |
| ORG-2 | It starts from a template, chosen by the type of business: hardware store, salon, tuition centre, home kitchen and attendance for Business; our home, joint family, elder living alone and students sharing a flat for Family; apartment association, housing society, temple or church committee, club, self-help group and parents' group for Community. A template creates units, roles and starter services in one step. | Built: `ORGANISATION_TEMPLATES` (`templates.ts`), all fifteen, each with its starter services (one more, Time off, in every business template); `POST /api/library/templates/:id` creates them as drafts in one step, offered per edition. |
| ORG-3 | A step may name `role: manager-of-requester`. The runner follows `reports_to` from the requester's unit, so an approval reaches the requester's manager, not every manager. | Built: `managerOf` and `resolveForRequester`: the case service rewrites the journey for its starter when the case starts (Worker and devices), so the rest of the engine sees an ordinary role. A visitor's request goes to the lead of the unit that runs the service. |
| ORG-4 | How units work together is drawn from published services (hand-overs and declared dependencies, DEP in 14), weighted by case events, never drawn by hand. | Built: `unitLinks` (starters, then each screen's role, then finishers), with optional weights per journey; shown as "How units work together". Weighting by case events on the dashboard is open. |
| ORG-5 | Before publishing: a service role that no unit holds is a warning, and a unit that runs a service with nobody staffed is flagged. | Built: `organisationChecks` (a service role no unit holds, a unit running a service the catalogue lacks, a unit running a service with nobody staffed), as warnings on the organisation entry and in `compileBundle`. |
| ORG-6 | Business identity: GSTIN (per site), Udyam, D-U-N-S, CIN or LLPIN, PAN, FSSAI and other licences, each shown with its trust level: declared, valid format (check digit), registry verified (through a connector), or document attached. The directory shows the badge, and verified businesses rank first. | Planned |
| ORG-7 | A sole proprietor's PAN identifies a person: it is masked on screen and never sent to a cloud model. Aadhaar is never collected. | Planned |
| ORG-8 | In a household, guardianship replaces reporting lines and applies only to children. Nobody in a household reports to anyone. | Built: a `type: household` organisation refuses `lead` and `reports_to`, and `managerOf` returns nobody. |
| ORG-9 | No HR records, salaries or job grades in the organisation document. | Built (as a rule): HR keys (salary, pay, grade, band, appraisal…) are refused with a reason anywhere in the document. |

## Shared vocabulary

| ID | Requirement | Status |
|---|---|---|
| VOC-1 | YAxb uses schema.org's general types as its vocabulary, with W3C DPV for consent, purpose and storage duration. Health types and every clinical code belong to the Clinux layer (FHIR). | Planned |
| VOC-2 | Each directory listing is published as `LocalBusiness` (or `Organization` for a community) JSON-LD with its `OfferCatalog` of services, and must validate as schema.org. | Planned |
| VOC-3 | Field entities are named by their schema.org property (price, telephone, address), so slot filling and connectors agree on meaning. | Planned |
| VOC-4 | A case maps to a schema.org `Action` and to Clinux's FHIR `Task` with no field lost. | Planned |
| VOC-5 | Fetched web pages keep their own JSON-LD as notebook facts. | Planned |

## Storage housekeeping

Nothing on the device is ever removed today, and Anjal never asks the browser to keep its data.

| ID | Requirement | Status |
|---|---|---|
| STO-1 | Preferences → Storage shows a meter: total used, the browser's quota, and the size of each category (models, conversations, cases, sync data, queued events, team chat, media, map tiles). | Built: `StorageMeter.vue` (`lib/browser/storage-meter.ts`): the browser's estimate, and each of the kiosk's IndexedDB databases, Cache Storage (models) and local storage, measured on the device. Media and map tiles appear once they are stored. |
| STO-2 | Kiosks and installed apps ask for persistent storage (`navigator.storage.persist()`). | Built: asked at start by the native app, an installed app and a front desk; anyone can ask from the meter. |
| STO-3 | When a Restricted Mode session ends, the visitor's conversation, form drafts and media are wiped from the device. | Built: the conversation, the visit's notebook and its words, the consent answers, the message box and open forms go; requests waiting to be delivered stay. |
| STO-4 | "Free up space" lists suggestions, largest first, each saying what will be removed and whether a copy exists elsewhere. A notebook or a conversation can be exported first. | Planned |
| STO-5 | An automatic cleanup runs once a day when the device is idle and charging, and at once when free space falls below a threshold. It never removes anything that exists only on this device and has not expired: unsynced changes, undelivered cases and unsent events are always kept. | Planned |
| STO-6 | How long a record is kept: a statutory minimum (RET) always wins. After that, the shortest of the service's consent form, the business's policy and the person's own choice applies. Families have a "keep forever" mark that cleanup always respects. | Planned |
| STO-7 | Each run records `storage.cleaned` with counts and sizes only. | Planned |
| STO-8 | An administrator may set a storage budget per kind of device. | Planned |
| STO-9 | The box compacts sync tombstones once every device has passed them, deletes media no record points to, and moves deleted items to a 7-day bin first. | Planned |

## Statutory retention

**Decided 2026-11-20: the platform is not responsible for a business's audit or statutory duties.** On the free plan every record is deleted 30 days after creation; on the paid plan a service's records are kept for the one period its design declares, not per field. RET-1..7 below are the per-class design that decision replaces for now; RET-1 survives as a single period per service (not per field or case type) and RET-4 as the legal hold, RET-2, RET-3, RET-6 and RET-7 are dropped as platform duties (the designer shows the author a notice instead). See `docs/architecture/hardening.md`.

| ID | Requirement | Status |
|---|---|---|
| RET-1 | Each service field, case type and connector export may be tagged with a record class (tax-invoice, payroll, attendance, consent, audit). The jurisdiction's realm pack gives each class its minimum period. | Planned |
| RET-2 | No cleanup, policy or person may delete a protected record before its minimum. A business policy shorter than a minimum is refused, naming the law. | Planned |
| RET-3 | A device may drop its copy of a protected record only when the box or server holds it. When the device holds the only copy, the action is disabled and says why ("GST record: kept until March 2032"). | Planned |
| RET-4 | An administrator can put a case, a member's records or a service on legal hold, which stops all deletion until released. | Planned |
| RET-5 | Every deletion of a protected class is logged (class, count, when, by which rule), and the log is kept for the longest period it covers. | Planned |
| RET-6 | The Legal Guardian adds the statutory period to a consent form's "kept for" wording. The designer warns when a service collects a protected class without saying so. | Planned |
| RET-7 | The defaults are not legal advice. They must be confirmed by a chartered accountant or lawyer before they ship, and the person who confirmed them is shown in Preferences → Storage. | Planned |

## Audit

| ID | Requirement | Status |
|---|---|---|
| AUD-1 | Audit rows and service events can be exported as one record shape (who, what, which target, when, outcome, facts), as a schema.org `Action`. Clinux maps it to FHIR AuditEvent and Provenance. | Planned |
| AUD-2 | Each audit record carries the hash of the one before it, per tenant. The box and the server compare chain heads daily. | Partly built: the chain (`auditHash`, `verifyAuditChain`, migration 0015 with a per-tenant head that a record can only follow, so two writes can't fork it) and `GET /api/admin/audit/chain` (head and check), shown in Administration. The box's daily comparison waits for the box to hold the log. |
| AUD-3 | Reading or exporting the audit log is itself audited (`audit.viewed`, `audit.exported`). | Partly built: `audit.viewed` when the audit log or a service's audit trail is read. `audit.exported` is defined for the export, which isn't built. |
| AUD-4 | Form filling is measured per run: six counts (filled, asked, resolved, dismissed, out of scope, unmatched), plus the ids of fields that ended unmatched, dismissed or out of scope. Never the values, and never per person. Per-field events are not kept. | Planned |
| AUD-5 | Each feature in 12–16 adds its audit actions and events when it ships, facts only. None may hold answers, messages, photos, transcripts, face images or connector payloads. | Planned |
| AUD-6 | A case passed to another service or business carries a trace (trace id, parent, root, hop count capped at 10, a keyed digest of what this hop received, the sender's signature), never the earlier request's payload. `trace.sent` and `trace.received` record the trace without the payload. | Planned |

## The Ethics Counsellor

| ID | Requirement | Status |
|---|---|---|
| ETH-1 | A check without a model runs on every design: protected-attribute words (gender, caste, religion, colour, nationality, region, language, disability, age, marital status) in field ids, labels, options and conditions, in English, Tamil and Hindi. Its findings appear as warnings in `compileBundle`, with their lines, and it works in Kiosk-only mode. | Built: yaxb-journeys `ethicsChecks` (`ethics.ts`); a question asking for an attribute is medium, a condition or decision reading one is high. |
| ETH-2 | An `ethics-counsellor` subagent of the Service Designer agent reviews the whole design. Its findings (severity, line, reason, suggested change) go into the repair loop as suggestions, never applied silently. Accepted and rejected suggestions become designer lessons. | Planned |
| ETH-3 | Lawful differences (a women's hostel, a senior citizens' discount, reserved scholarships) are allowed. The designer states the purpose, which is kept with the published service and shown to the reviewer. | Planned |
| ETH-4 | The catalogue's review shows an Ethics checklist. A reviewer cannot accept a service with an unresolved high-severity finding without writing a reason. | Built: the review form's Ethics checklist; the library refuses an accept with a high finding and an empty note (422). |
| ETH-5 | Every review is audited (`ethics.reviewed`, finding counts only). The rules are published and versioned. The counsellor never collects protected attributes to measure fairness. | Partly built: the accept and reject audit rows carry `ethics_high` and `ethics_medium` counts. Publishing and versioning the rules is open. |

## The player

| ID | Requirement | Status |
|---|---|---|
| PLY-1 | Speaking is done from the message box only: the player's large microphone goes. Pause/Resume and Stop sit beside the message box's microphone, shown only while an answer is read aloud. | Built |
| PLY-2 | Profile, Preferences, Conversations and Contacts become round console buttons in the player. New conversation stays in the tab row or moves to the + menu. At the front desk, End session and the staff lock are player buttons too. | Built |
| PLY-3 | Full shows the buttons with labels, Pod shows the icons in a row, and Mini shows Profile and a "more" button. | Built |
| PLY-4 | Contacts are family members in Family, staff in Business, and the committee and neighbours in Community, with who is online, chat and call. They respect the child lock: no strangers, and no calls without a parent. | Partly built: Contacts opens the team for members (Business staff), hidden with the child lock. Family members and Community contacts wait for EDN. |
| PLY-5 | Stopping speech must stay reachable when the message box is hidden: a stop chip floats over the answer being read, and a spoken "stop" stops it. | Partly built: the floating stop chip. A spoken \"stop\" while reading needs listening during speech (echo), still open. |
| PLY-6 | `docs/ux/patterns.md`'s Players table is updated, and the Service Catalogue's player follows the same anatomy. | Built |

## Answers about each service, without a model

| ID | Requirement | Status |
|---|---|---|
| FAQ-1 | A `service-helper` subagent drafts 10 to 30 questions and answers for a service, from its YAML, consent form and notebook. Each answer cites its source (a screen, the consent form, a document). It does not answer what the sources do not say. | Planned |
| FAQ-2 | The FAQ is an `faq:` block in the service YAML, in the service's languages, reviewed with the service (and by the Ethics Counsellor). An answer may carry an action ("Start the booking"). | Planned |
| FAQ-3 | The FAQ's questions are embedded with the kiosk's models (MiniLM and LaBSE) **in the publishing person's browser**, and the vectors are published with the service revision. Models never run in the Worker. | Planned |
| FAQ-4 | A kiosk matches a question against the loaded services' FAQs and the global list, answers word for word citing `service:<id>#faq-<n>`, and offers the action. This works in Kiosk-only mode. | Planned |
| FAQ-5 | When a service, its consent form or its notebook changes, the entries whose sources changed are marked stale, with replacements drafted for review. Questions that were "not covered" for a loaded service become FAQ proposals on its dashboard. | Planned |
| SNB-1 | A service's notebook (documents, brochures, price lists, images) is compiled when the service is published, in the publishing person's browser: text (pdf.js, OCR for images, alt text), passages with their source and page, a word index (BM25-style) and embeddings for both models. It is packaged with the service revision and cached by each kiosk that loads the service. | Planned |
| SNB-2 | With no embedding model, the FAQ and the notebook are matched on the word index alone, so the cheapest device still answers from the service's own words. | Planned |
| SNB-3 | Each document has a visibility: public (answers visitors), staff (answers signed-in staff only) or reference (used for the FAQ, never quoted). New documents are staff. | Planned |
| SNB-4 | Public documents are scanned for phone numbers, ID numbers and faces before review. The designer confirms the business may publish each document and image. | Planned |
| SNB-5 | A new document version recompiles only the passages that changed and marks the FAQ entries that cited them as stale. | Planned |

## Order of work

1. SPL-1..7 and 10, PLY, ETH-1 and 4, AUD-2..3, STO-1..3. These are small and need no new storage.
2. VIS, ORG and VOC, then STO-4..9 and RET before any media ships.
3. FAQ and SNB, then ETH-2..3 and SPL-8.
