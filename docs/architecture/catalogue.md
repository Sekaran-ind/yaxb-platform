# The Service Catalogue, designer, consent and organisation

Part of the architecture notes for Claude Code; the index is in [CLAUDE.md](../../CLAUDE.md).

## The Service Catalogue (LIB-1..20)

- **Nested services** (`packages/yaxb-journeys/src/nested.ts`): `kind: service` with `roles: [{ id, label, description }]` and `journeys: [{ id, title, roles: { initiate, complete }, screens: [...] }]`.
  - A screen has `questions` (fields), or `service`/`with`, or `decide`, or `result` (which ends the journey). Screens follow one another unless `next` says otherwise; a last screen that doesn't end the journey gets an `end` step.
  - `expandService` turns it into a flat service (items = journeys) and flat journeys (steps = screens). `compileBundle` does this automatically, rewords "step" as "screen" in problems, and returns `bundle.roles`.
  - A journey may name the service's roles, the built-in ones, and `visitor`.
- **Package**:
  - `roles.ts`: `DEFAULT_ROLES` (administrator shown as Admin, moderator, reviewer), `VISITOR_ROLE`, `canInitiate`, `roleLabel`.
  - `forms.ts`: `ServiceDesign`/`JourneyDesign` with `designFromDoc`/`designToDoc` (screens are `StepForm`s, questions as YAML text). New journeys have no starters, which means anyone. Also `idFromName`, `serviceTemplate`, and the older flat converters.
  - Vue:
    - `ServiceDesigner` is four steps with a numbered step list and Previous/Next: Service → Roles (`RolesPanel`: add roles, the role × journey matrix) → Journeys (master/detail: the list with add, reorder, remove, beside the chosen journey's `JourneyDesigner part="all"`; narrow, into one and back) → Review (compiles the design: problems and `ServiceSummary`). A live `FlowPreview` pane sits beside the steps from 62rem ("Show preview" toggles it). Screens' questions use `QuestionsEditor` (a list in plain words; "Edit as YAML").
    - Also `RolePicker` and `YamlEditor`.
  - Field types include `password` (a masked input).
  - `checkDocument(yaml, others, options)` checks one service alone.
- **Core** `library/` (export `./library`):
  - Entries are nested services (kind `service`) with an owner (`owner_id`: a member id, `admin`, or `guest:<clientId>`), revisions, `published_yaml`, and status draft → in_review → accepted/rejected, plus archived.
  - `createLibraryService(store, { services, audit, auditTrail })` takes a `LibraryActor` ({ id, name, roles, admin, guest? }) and refuses with `LibraryError(message, status)`.
  - Permissions:
    - Anyone may design. A guest sees and changes only their own services, and at most `MAX_GUEST_SERVICES` (20).
    - view = any member; edit = administrator/moderator/curator; review = reviewer/administrator, never your own; manage = administrator.
  - Service ids are unique across the catalogue. A service without a library goes to the "Service catalogue" library, which is created on first use.
  - `seed(yamls)` publishes the kiosk's own services (`content/catalogue`, owner `system`) once each. A service id the catalogue already has, even archived, is left alone. The Worker's `catalogue(env)` seeds once per isolate before every catalogue route.
  - `published(viewerRoles)` returns `{ roles, services: [{ entry_id, library, roles, journeys: [{ initiate, complete, allowed }], yaml }] }`. `roles` combines the built-in, organisation and service-defined roles. `auditTrail(actor, id)` reads the audit log by target.
  - Stores: memory and D1 (migrations 0006 and 0007: owner columns, audit by target). Tests run on both.
  - Audit actor type `guest`.
- **Worker**:
  - `libraryActor` always returns an actor; a guest is identified by their session.
  - `GET /api/library/published` is public. `/api/library` (overview: me, roles, libraries, services, queue), `POST /api/library/services` (rate-limited for guests), `/api/library/entries/:id[/audit|/submit|/review|/archive|/restore]`, plus roles and libraries routes.
  - A member's roles may be built in, organisation roles or published services' roles.
- **Web**:
  - `/catalogue` (`pages/CataloguePage.vue`, linked from the navbar and the home page; `/studio` redirects to it) uses the kiosk's `KioskFrame` and layouts (Preferences → Layout, Auto by width; Pod and Mini grow with the content); it stays a separate surface (`docs/ux/kiosk-and-catalogue.md`):
    - The frame holds `CataloguePlayer`, the catalogue's player on the shared `components/site/ConsolePlayer.vue` (the kiosk's `PlayerPanel` uses it too): the open service and the designer's step (`ServiceDesigner` emits `step`) as "now playing", the counts as meta, Staff sign in or sign out as the personal button, Open the kiosk and New service as the actions.
    - The `AdaptiveNav` holds the screens: catalogue, mine/all, review, roles and libraries. `?service=<id>|new` opens `components/catalogue/ServiceWorkspace.vue` (Design, YAML, Preview, Summary, Audit, History).
  - The kiosk keeps its built-in services on Services. Notebook → Services (`CatalogueServices.vue`) loads published services (`composables/library.ts`, the choice kept in localStorage `yaxb.kiosk.catalogue`; `/kiosk?load=<entry id>` loads one). Journeys a viewer can't start show locked with the roles that start them.
  - JourneyPanel says "Next: <role> will complete this".
  - Not built: server-side slot filling for catalogue journeys. Handing journeys between roles is the next section (cases).

## The Service Designer agent (LIB-27..32, LIB-39..41)

- **Core** `designer/` (export `./designer`):
  - `kiosk.design({ narrative, selection, published, lessons, roles })` drafts a nested service from a narrative (`designInputSchema`, 20..4000 characters). It returns `{ yaml, title, problems, ok, notes, examples }` or `{ error }`, and stores nothing.
  - Few-shot: `examplePool(kioskContent.designer, published)` holds the built-in examples (`content/designer/*.example.yaml`, `narrative` + `service`, compiled by the content test) and published services (`narrativeOf` writes their narrative). `pickExamples` gives the closest `PROMPT_EXAMPLES` (2) by shared words, always with a built-in one. `designerPrompt` holds the format, `FIELD_TYPES`, `SERVICE_INFO`, built-in roles, `DESIGNER_ICONS` (keep them in step with the web's `lib/icons.ts`) and the rules.
  - The agent is `createServiceDesignerAgent` (`agent/harness.ts`): Deep Agents with tools `find_similar_services`, `check_service` (`checkDocument` plus `draftProblems`: a `when` reading its own screen's `answers.`, and `{{#if}}`-style blocks) and `submit_design`. It has the safe file tools and `subagentGuard([])`, and the lessons as Deep Agents `memory` (`/memories/AGENTS.md` from `lessonsMemory`). A submit with errors goes back, up to `REPAIR_ATTEMPTS` (3). Lean models, or an agent that never submits, get a direct reply (`yamlFromReply`) repaired the same way.
  - Learning: `createDesignerService(store)` with `recorded` (a run: the draft, never the narrative), `link(run, entry, owner)` (author only, once), and `learn(entry, decision, note, reviewer)`, called through the library's `onReviewed`. `lessonFrom` uses `designChanges` (draft → reviewed): an unchanged acceptance teaches nothing. `addLesson` and `removeLesson` are for administrators. The agent reads the newest `LESSONS_IN_MEMORY` (30); the store keeps `MAX_LESSONS` (300).
  - Stores: memory, and D1 `createD1DesignerStore` (migration 0008: `design_runs`, `design_lessons`).
- **Worker**: `POST /api/library/design { narrative, provider, model }` (chat limiter for everyone, form limiter for guests too; returns the draft plus `run`). `POST /api/library/services` takes an optional `design` (the run id) and links it. `GET|POST /api/library/lessons` and `DELETE /api/library/lessons/:id` are for administrators only (`permissionsOf(a).manage`). `designer(env)` in `worker/kiosk.ts`; the library's `onReviewed` calls `learn`.
- **Conversation** (LIB-39..41): `designInputSchema` takes `current` (the editor's YAML), `history` and `review`; `requestText` asks the agent to change the current service and keep the rest. Threads are `design_messages` (migration 0010; `turn`, `thread`, `linkThread`, `historyOf`). `GET /api/library/design?entry=|thread=` reads one; the POST takes `entry` or `thread` and `current`. Who may talk: a new thread's starter; an entry's editors, or a reviewer while it is in review (`applies: false`, suggestions only). A rejected entry's review note goes with each turn.
- **Web**: `DesignerChat.vue` in `ServiceWorkspace` (new services and saved ones), a chat thread like the kiosk's (LIB-63): the first message describes the service, later ones ask for changes; a draft goes into the editor with Undo. The designer agent gets up to `THREAD_TURNS` (40) earlier turns and compacts past `COMPACTION.designer`. An uncreated service and its thread are kept in localStorage `yaxb.catalogue.unsaved` ("Start over" clears it).
- Drafting uses the kiosk's model choice (`effectiveSelection`); without a model the panel says so. Catalogue → **AI designer** (`DesignerLessons.vue`, administrators) lists, adds and deletes lessons.

## The Legal Guardian: consent (CON-1..8)

- **Package** (yaxb-journeys `consent.ts`): `consent: { version, forms: [{ role, title, points, agree }] }` in nested services (`serviceConsent` validates, called by `expandService`; `consentFormFor(consent, roles, allowed)` picks a person's form, a staff role's own before the visitor's). `ServiceDesign.consent` carries it through the designer untouched.
- **Core** `guardian/` (export `./guardian`): `consentFacts(doc, { storage, relayHours, roles })` (per role: starts, completes, answers, gives, sees, seenBy, toAssistant), `sensitivityOf`, `guardianFlags`, `draftConsent` (plain words, no model), `GUARDIAN_SCHEMA`/`GUARDIAN_PROMPT`/`checkRewrite` (one point for one, or the draft stays). `kiosk.guardian({ yaml, storage, relayHours, roles, selection })` returns `{ consent, facts, flags, via, note }`, raising the version when the wording changes. Stores nothing.
- **Worker**: `POST /api/library/consent { yaml, storage, provider?, model? }` (anyone who may design; chat limiter, form limiter for guests).
- **Web**: the Consent view in `ServiceWorkspace` (`catalogue/ConsentPanel.vue`); `composables/consent.ts` (`useConsent().pending/answer`, localStorage `yaxb.consent` per profile, the visit only at the front desk, events `consent.given`/`consent.declined` with `step: consent-v<n>`); `kiosk/ConsentGate.vue` before a catalogue journey or a resumed part in `JourneyPanel`, and before a finisher's request in `CaseView`.
- **Typed values** (JRN-16): field entities `url`, `money`, `measure` besides `email`/`phone`; `SlotHelpers.values` (core) backed in the browser by `lib/browser/recognizers.ts` (Microsoft Recognizers-Text sequence and number-with-unit, English rules for every language, lazy-loaded).

## The organisation (ORG-1..5, 8..9)

- yaxb-journeys `organisation.ts`: `kind: organisation` (`type` business | household | community; `sites`; `units` with `lead`, `roles`, `reports_to`, `services`, `sites`); `compileOrganisation` (a role belongs to one unit, no loops, no HR keys, no reporting lines in a household), `managerOf`, `resolveForRequester`, `needsManager`, `organisationChecks` (ORG-5 warnings), `unitLinks` (ORG-4), `unitTree`. `MANAGER_OF_REQUESTER` (`roles.ts`) is a step role or a finisher, never a starter. `compileBundle` takes organisation documents (`bundle.organisations`, their roles in `bundle.roles`). `templates.ts`: `ORGANISATION_TEMPLATES`, `templatesFor(edition)` (each with starter services; business templates add Time off for the requester's manager).
- Core library: `ENTRY_KINDS` includes `organisation` (one per catalogue, administrators only; migration 0016 rebuilds `library_entries` and `library_revisions`); `published()` returns `organisation` and its roles; `templates`, `applyTemplate`; `memberRoles` option for the staffing check. Cases: `CaseOptions.organisation` resolves `manager-of-requester` at start and keeps the resolved journey. Worker: `GET /api/library/templates`, `POST /api/library/templates/:id` (edition from `SURFACE`).
- Web: `catalogue/OrganisationScreen.vue` (the catalogue's Organisation screen: templates, or the organisation), `catalogue/OrganisationView.vue` (units, who approves for whom, how units work together, warnings), the workspace's Organisation view for organisation entries; `library.ts` `publishedOrganisation`, used by `case-network.ts`.
