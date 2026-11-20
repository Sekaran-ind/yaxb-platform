# Journeys: engine, questionnaires, media and maps

Part of the architecture notes for Claude Code; the index is in [CLAUDE.md](../../CLAUDE.md).

## Questionnaires and the journey studio (JRN-30..35)

- **Engine** (`packages/yaxb-journeys/src`):
  - `fields.ts` holds `Field`, `fieldListProblems`, and the `when` visibility logic (`fieldVisible`, `formProblems`, `keptAnswers`). `when` may read `values.*`, `answers.*` and `context.*`.
  - `questionnaires.ts`: `kind: questionnaire` with `sections` (or `fields`). A journey step with `questionnaire: <id>` gets its `fields` and `sections` copied in by `compileJourney(src, { questionnaires })`. `RunState.prompt.sections` carries the pages.
  - `bundle.ts`: `compileBundle(yaml, { services, screens })` takes multi-document YAML in any order. It returns `{ services, journeys, questionnaires, documents, problems[{ level, line, kind, id, message }], ok }`. `problemLine` points at the quoted name. `previewHandlers` provides stand-ins.
  - Core content may hold `content/questionnaires/*.questionnaire.yaml`.
- **Vue** (`packages/yaxb-journeys/vue`):
  - Components: `AdaptiveNav` (navigation only: the host picks the mode; `switchable` opt-in for a Display menu, `lockMode` deprecated; `lead` slot; `fill` in every mode; narrow: up to 4 screens as tabs, else a section menu), `ConfirmAction`, `QuestionnaireForm` (sections as nav screens), `JourneyRunner`, `ServiceItems`, `FlowPreview`, `StructureTree`, `FlowStudio`.
  - Plain CSS with `.yj` and `--yj-*` tokens. The defaults are in `:where()`, and `apps/web/src/styles.css` maps them to the site's theme tokens.
  - Icons come from the host via `provideIcons`.
- `FlowStudio` (a free YAML editor with preview) stays in the package; the portal uses the Service Catalogue instead.
- `YamlEditor` lazy-loads CodeMirror 6 (`vue/yaml-codemirror.ts`, its own chunk; `@codemirror/*` and `@lezer/*` are external in the library build) and takes `problems` (line, level, message) as lint marks; a textarea is the fallback.
- The web uses the package's `AdaptiveNav` everywhere (kiosk, Preferences, catalogue, staff sections); `main.ts` imports the package's `style.css` and provides `iconFor` through `ICONS_KEY`. The package's element resets sit in the `yj-base` cascade layer so host classes win inside it.
- `ConfirmAction` (package) is the one confirmation for destructive actions, in the web and the package; never `window.confirm`. A line of text is asked with `askText` (`composables/dialog.ts`, the `TextDialog` overlay mounted once in `App.vue`), never `prompt()`; ESLint's `no-alert` is an error. `components/site/SegmentedControl.vue` is the web's segmented control. `ServiceDesigner`'s last step renders the host's `finish` slot (props `ok`, `errors`) and emits `last`. See `docs/ux/patterns.md`.

## Journeys as state machines (JRN-40..44)

- yaxb-journeys `machine.ts` (export `./machine`, and from the root): `journeyMachine(j)` (XState 5: a state per step, each way out its own event: `SUBMIT[.n]`, `DONE[.n]`, `ERROR` → next or `(failed)`, `DECIDE.n`; structure only), `journeyGraph(j)` (`@xstate/graph` `toDirectedGraph`, plus kind, role, depth, reachable; unreached steps get their own rows below), `waysThrough(j)` (shortest path to each ending), `designChecks(j, { roles, order })`. `compileBundle` adds the checks as warnings (screens never reached, loops with no ending, an approval that is a decision nobody is asked for, a role one letter from a known role). The runner (journeys.ts) still runs journeys.
- The Ethics Counsellor's check without a model (ETH-1, ETH-4): yaxb-journeys `ethics.ts` (`ethicsChecks`, `protectedAttributeIn`, `ETHICS_WORDS` in English, Tamil and Hindi). `compileBundle` adds its findings as warnings with `ethics: { severity, attribute }`; the library's `review` refuses an accept with a high finding and no note, and audits the counts; `ServiceWorkspace`'s review form shows the Ethics checklist.
- Vue `FlowDiagram` (SVG, `.yj-fd-*` styles); the web's `catalogue/JourneyFlow.vue` is the workspace's Flow view (diagram, the journey's warnings with their lines, ways through). The designer prompt carries the same rules.

## Running journeys on XState; parallel journeys (JRN-45..49)

- yaxb-journeys `run.ts`: `createRunner` runs every journey on an XState actor (sequence: a state per step with `enter`/`asking`/`waiting`/`run`/`route`; a hop counter keeps "went round in circles"). `flow: parallel` (Journey) with `after:` (Step): the tasks are regions of a `tasks` parallel state (pending → ready → active → done), then the first non-task step; `focus(step)`, `RunState.tasks` (`TaskState`), `journeyTasks`, `afterTasks`; `replay` answers tasks in any order. `settle()` waits for running services and focuses this person's first ready task. Nested services take `flow` and screen `after`; `ServiceDesign` keeps them (`JourneyDesign.flow`, `StepForm.after`). Vue `JourneyTasks` in `JourneyRunner` and the web's `JourneyPanel`. `machine.ts` has a parallel graph (`parallelGraph`).

## Journey summaries

- `journeys/summary.ts`:
  - `summarizeJourney` (JRN-20) gives a journey's steps in run order, what it asks for, the services it uses (`SERVICE_INFO`, one entry per `JOURNEY_SERVICES` name, checked by a test), `leavesDevice`, and a one-line `privacy` sentence.
  - `journeysText` goes into the deep agent's offerings (JRN-21).
  - `summarizeRun` (JRN-22) gives the steps, the answers as displayed, the result, and Markdown.
- Web:
  - `JourneySummaryCard.vue`: the info button on each journey item, and "How each service works" on Services.
  - JourneyPanel shows the privacy line, "What this service did" and "Save to notebook".
  - The profile shows question and service counts from the activity log.

## Photos and voice notes (MED-1..12)

- yaxb-journeys: field type `photo` (`max`, `read`, `keep`; `MediaRef`, `isMediaRef`, `MAX_PHOTOS`); vue `MediaCapture` (in `QuestionField` and the kiosk's `JourneyField`) with the host from `provideMedia`/`MEDIA_KEY` (`media.ts`: `save`, `url`, `read`, `allowed`; `shrinkPhoto`, `mediaRefOf`).
- Web: `lib/browser/media.ts` (IndexedDB `yaxb-media` by hash; `pushToBox`, `pullFromBox` checking the hash), `composables/media.ts` `kioskMediaHost` (provided in `main.ts`; `keep: box` pushes at once or on `online`; reads text with Tesseract.js (`lib/browser/ocr.ts`, English and the kiosk's language) and describes with `readImage` (Florence-2 in `workers/media.worker.ts`); media goes to the box whenever one is connected unless `keep: device`; no camera in child mode), `kiosk/MediaThumbs.vue` in `CaseView`. Core: summaries carry `media`, slot filling and the agent's field list skip photos, the guardian counts `photo`. Box: `/v1/media/<hash>` (PUT checks the SHA-256; JPEG, PNG, WebP; 4 MB). Seed: `content/catalogue/repairs.service.yaml`. Voice notes: field type `audio` (`max_seconds`, `transcribe`), MediaCapture records and plays them, `transcribeAudio` (Whisper base in `media.worker.ts`), handlers `media.read` and `media.transcribe` in KioskShell (`mediaHost`), events `media.captured`/`media.read` (MediaCapture `noted` → JourneyPanel `record`); the guardian's `voice`; the designer knows both (example `photo-report`).

## Maps (VIS-1, 2, 5, 7, 8)

- yaxb-journeys `geo.ts` (from the root): `geoPoint`/`latLngOf` (schema.org GeoCoordinates), `geoShape`/`shapeCorners` (GeoShape, "lat,lng" points, closed ring), `distanceMetres`, `insideArea`, `areaSquareMetres`, `nearestPlace` (Turf.js, on the device). Field types `location` and `area` (`fieldProblem` checks them). Vue: `GeoPicker` (search through the host, tap, drag, "Use my location" only on a tap, corners for an area) and `MapView` (places and areas), each `defineAsyncComponent` so Leaflet loads only where used; `provideGeo`/`GEO_KEY` (`GeoHost`: `search`, `locate`, `tiles`); Leaflet and Turf are external in the library build. Dark themes (`night`, `contrast`) dim the tiles.
- Web: `composables/geo.ts` `geoHost` (provided in `main.ts`; search via `GET /api/places/search`, no location under the child lock, `VITE_TILE_URL`), `JourneyField` renders `GeoPicker`. Worker: `/api/places/search` (Nominatim or `PLACES_URL`, Cache API per edition and business, a week; one request a second per isolate; the chat limiter), the CSP's `img-src` allows OpenStreetMap's tiles and `TILE_ORIGIN`. Core: summaries show a place rounded, slot filling and the agent skip the types, the guardian counts them as location, the designer knows them. Seed: Repairs has an optional place.

## Charts, timelines and display blocks (VIS-3, 4, 6, 7)

- yaxb-journeys/vue: `PlotChart` (Observable Plot, bars or a line over `{ label, value }`, themed from `--yj-*` tokens and redrawn on a theme or width change, the numbers also in a table), `EventTimeline` (d3-scale and d3-zoom: lanes, wheel, drag, pinch and buttons; a list by day under 560px or by choice; emits `select`), both `defineAsyncComponent`; `@observablehq/*` and `d3-*` are external in the library build. `DisplayBlocks` reads a run's blocks loosely (places, areas, `{ label, value }` pairs or a mapping of numbers, dated items) and loads each component only when needed.
- Engine: `Step.show` (`DISPLAY_KINDS` map, chart, timeline; `{ from: "{{…}}", title?, kind?: bar|line }`, `showProblems` in `journeyProblems`; nested screens carry `show`, `StepForm.showYaml` keeps it in the designer). The runner fills `data` from the template into `RunState.prompt.show` and `result.show` (`ShownBlock`); `JourneyRunner` and the web's `JourneyPanel` render them.
- Core `timeline/` (export `./timeline`): schema.org Events (`TimelineEvent`) from `occurrenceEvents` (the Scheduler, a lane per kind), `caseTimeline` (a request's thread: who and when, never a note's words) and `sourceEvents` (dated notebook sources). Web: the Scheduler's Timeline view, CaseView's "On a timeline", NotebookScreen's sources "On a timeline"; `ServiceDashboard` draws its weeks and funnels with `PlotChart`.
