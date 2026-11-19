# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Where things stand, what's next and how the owner likes to work: `docs/HANDOFF.md`.

## Layout

This is an npm-workspaces monorepo with one core and several surfaces, the same pattern as clinux-core with clinux-desk, clinux-pro and clinux-diary:

- `packages/yaxb-core` (`@sekaran-ind/yaxb-core`): TypeScript built to `dist/` with `tsc`. It holds the kiosk agent and everything the surfaces share. Behaviour changes go here, not in a surface.
- `packages/yaxb-journeys` (`@sekaran-ind/yaxb-journeys`): Service → Journey → Questionnaire, installable in other projects. It has two parts:
  - A headless engine (tsc → `dist/`): journeys, expressions, fields, questionnaires, services, screens and bundles.
  - Vue components (`vue/`, built with Vite library mode plus vue-tsc → `dist/vue/`, with `style.css`).
  - yaxb-core re-exports the engine as `./journeys`, `./services` and `./screens`, so build this package before the core (`yaxb.mjs` and the core's `pre*` scripts do).
- `apps/web`: a Vue 3 single-page app (Vite, Tailwind 4) served as Workers static assets, plus a Hono Worker (`worker/`) for `/api` that runs yaxb-core's agent. Built and run by `@cloudflare/vite-plugin`.
- `apps/cli`: the `yaxb` command, plain ES modules. Its logic is in `src/cli.js` (`run()` takes an injected `createKiosk` and `account`); `src/main.js` wires it up. `yaxb login|logout|whoami` (`src/account.js`, IDN-41): signed in, `createKiosk` is yaxb-core `./remote`'s `createRemoteKiosk` (the site's /api/agent with the terminal's own credential, `$YAXB_HOME/credentials.json`), so no provider keys are needed.
- `apps/native` (`@sekaran-ind/yaxb-native`): the kiosk as an Android and iOS app (Capacitor 8). Its web content is `apps/web` built with `vite build --mode native` into `apps/web/dist/native`; see its README.
- `apps/esp32-s3-audio`: design notes for a future voice surface. There is no code yet.

## Commands

`node yaxb.mjs start [--preview] [--port N] | stop | restart | status | logs | cli <args> | test | deploy`

- `start` runs `vite` (the Vue app and the Worker together in local workerd, hot reload) and `tsc --watch` for the core, detached, with PIDs and logs in `.run/`.
- `--preview` builds and runs the production build on local workerd (`vite preview`).
- First run installs dependencies, creates `apps/web/.dev.vars` with secrets, and applies the D1 migrations locally. Chat needs at least one provider key (such as `ANTHROPIC_API_KEY`) added to `.dev.vars`; `cli` reads its keys from there too.
- `test` runs the core and CLI tests plus the web typecheck and lint. `deploy` applies the remote D1 migrations, then deploys the Worker.

From the root, `npm test`, `npm run typecheck`, `npm run lint` and `npm run build:core` run across the workspaces.

Per package:

```bash
# packages/yaxb-core
npm run build | npm run dev | npm run typecheck
npm test                                         # regenerates content.json, then vitest
npm run content                                  # regenerate src/data/content.json only
npx vitest run test/agent.test.ts -t "subagent"  # one test (doesn't regenerate content)

# apps/cli
node --test src/cli.test.js

# apps/web
npm run dev | npm run build | npm run preview | npm run deploy
npm run typecheck (vue-tsc -b) | npm run lint
npm run cf:typegen                                         # after changing wrangler.jsonc
npm run db:migrate:local | npm run db:migrate:remote
```

Surfaces import the core's `dist/`, so rebuild the core (or keep `start` running) after changing it. The root `.npmrc` sets `legacy-peer-deps`, which works around an npm resolver crash on vitest's optional peers.

## Core (`packages/yaxb-core/src`)

- `agent/index.ts`: `createKiosk({ env, threads, moderation, vector?, limits?, onError?, modelFactory? })` is the one entry point.
  - `ask()` validates input, loads the thread state, runs the agent with `streamMode: ["messages","updates","values"]` and `subgraphs: true`, and yields `AgentEvent`s.
  - It saves `{ messages, todos, files }` only when the turn completes. There is no LangGraph checkpointer, which keeps state portable across D1, files and memory.
  - Context (ANS-45..46): `client.device` (the browser's `deviceTurns`: exchanges answered on the device since the agent's last reply) goes before the turn's words via `deviceContext`. Compaction is Deep Agents' summarization middleware with `COMPACTION` thresholds (harness.ts `compaction()`, wrapped so the summary call is tagged `langsmith:nostream`; LangChain's `summarizationMiddleware` on the lean harness); `toThreadState` stores `compactedMessages(final)`, and `trimHistory` is the last resort.
  - Compiled agents are cached per (provider, model, temperature).
- `agent/harness.ts`: `createDeepAgent` with these protections:
  - `createFilesystemMiddleware({ tools: SAFE_FS_TOOLS })` on the agent and on every subagent, which replaces the default by name, so `execute` and `delete` are never registered.
  - `todoListMiddleware()`, added explicitly.
  - The `YaxbSubagentGuard` middleware, which refuses `task` calls to any undeclared subagent.
  - Harness profiles for `anthropic`, `openai` and `google` (Deep Agents detects these by model class; Ollama has none, which is why the guard exists).
  - `translate()` maps the stream to events. Tokens come only from the top-level namespace.
- `events/index.ts` holds the `AgentEvent` protocol and SSE helpers, used by the web server, the browser hook and the CLI. Changing an event shape affects every surface.
- `providers/index.ts` with `data/providers.json`: the allowlist. A provider is "configured" when its credential is a non-empty string in the env passed in. `temperature: false` marks models whose provider package rejects a custom temperature (Claude Sonnet and Opus 5.x, GPT-5.x). A test builds every catalog model to catch mistakes.
- `stores/`: the contracts plus memory implementations. `stores/d1.ts` is for Workers; its schema is in `packages/yaxb-core/migrations/`, which wrangler applies through `migrations_dir` in `apps/web/wrangler.jsonc`. `stores/node.ts` is for the CLI and imports `node:fs`, so never import it into the web app.
- Tests use `test/scripted-model.ts`, a fake chat model that replays steps, streams and records calls. Use it for harness tests; nothing calls the network.

## Web (`apps/web`)

- **Worker** (`worker/index.ts`, Hono): `/api/agent/chat` (SSE), `/api/agent/:resource` (providers, capabilities, sources, curated, moderation), `/api/moderator`, `/api/contact`, `/api/newsletter`. Everything else is `env.ASSETS.fetch` with security headers added. `wrangler.jsonc` sets `run_worker_first: true` (so pages get the CSP) and `not_found_handling: "single-page-application"` (so the Vue router handles unknown paths).
- CSP is static (no nonce): the app has no inline scripts. Box origins come from the `KIOSK_BOX_ORIGINS` var. Model hosts for Transformers.js are in `securityHeaders()`.
- Chat order: same-origin check, then session (`clientId`: Web Crypto HMAC of the `yaxb_sid` cookie, issued on first /api call), then rate limit, then body size (4.5 MB) and zod. `moderation` requires `isModerator` (cookie set by `/api/moderator`).
- `worker/env.ts` validates string settings; `worker/kiosk.ts` builds one kiosk per isolate. Binding types are generated into `worker-configuration.d.ts` by `npm run cf:typegen`.
- Provider SDKs: only `@langchain/anthropic` and `@langchain/openai` (every other provider uses an OpenAI-compatible endpoint), so the Worker stays about 1.4 MB gzipped. Local workerd can reach LAN Ollama in dev.
- **Vue app** (`src/`): `router.ts` lazy-loads pages; `composables/` replace React hooks (`settings.ts` is one reactive object saved to localStorage; `chat.ts`, `notebook.ts`, `speech.ts`, `width.ts`). `lib/browser/` (store, offline models, documents) is framework-free.
- Imports use `@/` (meaning `apps/web/src/`). Never put secrets in the client, and never log message content (the moderation queue may hold health details).
- Inside the kiosk, size grids by the kiosk, not the window: every `AdaptiveNav` screen body is an `@container`, so components use `@lg:`/`@2xl:` (container) instead of `sm:`/`md:` for columns (SET-17). The Mini kiosk has one fixed height (`MINI_HEIGHT` in KioskShell, `AdaptiveNav fill`), SET-18.
- Tailwind v4 has no config file. Tokens and reusable classes live in `src/styles.css`, and reusable classes must use `@utility`.
- Native mode (`lib/platform.ts` `NATIVE`, PLT-10..14): routes are only `/kiosk` and `/settings` (hash history), `App.vue` drops the site navbar and footer, `installNativeFetch()` sends `/api` calls to `VITE_API_BASE` with `X-Yaxb-Session`, and `composables/speech.ts` uses `lib/native-speech.ts` (Capacitor plugins) on a device. The Worker allows `KIOSK_APP_ORIGINS` with CORS, takes the header session only from them (`session.ts` `fromApp`), and counts them as same-origin (no cookies, so no CSRF).
- Themes (`lib/themes.ts`, `settings.theme`, SET-10..11): `[data-theme]` blocks in `styles.css` override the tokens, and dark themes invert Tailwind's gray scale (plus red-700/800 and green-800). Use `bg-surface`/`bg-canvas`/`bg-mist`, `text-ink`/`text-body`/`text-gray-*`, and `bg-brand-dark text-on-brand` for filled buttons and bubbles; never `bg-white` or white text on `bg-brand`. `bg-console` stays dark in every theme. Answers render through `AnswerText.vue` (`lib/answer-format.ts`: Markdown read into data, never `v-html`).
- The kiosk layout lives in `components/kiosk/KioskShell.vue`, which owns the chat, speech, notebook and journey handlers. Its frame is `components/site/KioskFrame.vue` (shared with the catalogue): Full fills the window wide and tall (panel column, screens scroll inside), Pod is a strip, Mini a fixed-height card. `AdaptiveNav` (from `@sekaran-ind/yaxb-journeys/vue`) renders each screen through a named slot. The kiosk is one frame (SET-14): `PlayerPanel` (slots `meta`, the notebook line via `MarqueeLine`, and `actions`, `PlayerButtons`) and the screens. The profile button opens `KioskPreferences` (which embeds `SettingsPanel`, with a Profile section) in place of the screens, driven by `/kiosk?prefs=<section>`; `/settings` redirects there and there is no settings page. Screens: Transcript, Services, Notebook, Sources. Services (`ServicesScreen.vue`, container queries) includes the *For staff* group (`content/services/staff.service.yaml`; a service item may open `staff: <section>`, `STAFF_SECTIONS` in core services), which shows `KioskStaff.vue` inside Services, with the staff sections in a tabs `AdaptiveNav` (QualityDashboard, AnswerReviews, CurateTimeline, TeamPanel, ModeratorProfile, AdminPanel). No separate staff pages: their old addresses redirect to `/kiosk?screen=services&staff=<section>`. In-section navigation keeps the other query keys.
- The kiosk's screens (LIB-54, `content/screens.yaml`) are labelled Ask Me (`transcript`), Quick tools (`services`) and My notebook (`notebook`); the ids stay. Ask Me has the conversations drawer (`ThreadDrawer.vue`, LIB-53). Requests open in the conversation, unfolded (`RequestCard` → `CaseView embedded`); `/kiosk?case=` and `?load=` are handled by the shell.
- The player (PLY-1..6): the person's controls are round buttons in the player (`PlayerButtons.vue`, `playerButtons`/`onPlayerButton` in KioskShell): Profile, Conversations (the drawer is `TranscriptPane`'s `v-model:drawer`), Contacts (members: the team), Child lock, Preferences; at the front desk End session and Staff. Full labels them, Pod shows icons, Mini shows Profile and More. The player has no microphone: the message box has it, with Pause/Resume and Stop while an answer is read (`speaking`, `paused`, emits `pauseResume`, `stop`); elsewhere a floating "Stop reading aloud" chip (`stopChip`). Only New stays a pill at the end of the tab row (`AskMePills.vue` in the `trail` slot; in the catalogue's Ask Me, New and Conversations). Ask Me has no header row; the model shows in the line under the message box, and the conversation uses the full width. Quick tools holds the built-in tools, For staff and staff's request lists (no For you, no Ask section, no reference box: references are typed in Ask Me). With several forms open, the newest (`formOrder`) takes the message box's words.
- The Service Catalogue matches: its player ("Anjal - Service Catalogue": mark, what is open, counts) holds its controls as `PlayerButtons`, like the kiosk's: Staff sign in/out (id `profile`, kept in Mini), New service, Open the kiosk, Preferences. The tab row's `trail` holds only Ask Me's pills (teleported into `#catalogue-ask-pills` while Ask Me is open).
- Designing in Ask Me (LIB-64): New service goes to `/catalogue?view=ask&design=new` (the home page's ideas add `&idea=`); `KioskShell` (`startDesign`, `designSay`, `onDesignUpdate`) adds a `ChatTurn.design` session that takes the message box's words through `offerFormInput`, and each message becomes a `reply` turn with the draft (`kiosk/ChatDesign.vue`: Create service, Open in the designer, which hands the draft and thread to `ServiceWorkspace` through `yaxb.catalogue.unsaved`). `?service=new` still opens the full designer. The published list carries each service's latest `state`; only accepted services are offered to add to a kiosk (one whose newer revision was rejected, or is a draft or in review, keeps running where it is loaded).
- Forms in the conversation (LIB-56): `composables/form-input.ts`. An embedded `JourneyPanel` offers its asking step (`offerFormInput`); `KioskShell.ask()` sends typed or spoken words there first, unless `askInstead`. The kiosk's name is `KIOSK_NAME` in `KioskShell` (LIB-57). Heights (LIB-58): `MINI_HEIGHT`, `POD_HEIGHT` (KioskFrame `podHeight`), Full's `FULL_HEIGHT`. `KioskShell embedded` is Ask Me alone, used by the catalogue's Ask Me screen; `openPrefs` opens `?prefs=` on the current surface, and `CataloguePage` shows `KioskPreferences` for it (LIB-59).
- Profiles (PRF-1..2) and the front desk (RST-1..5): `ProfilePicker.vue` ("Who's using Anjal?", shown while profiles exist and none is open, unless Visitor was chosen this session). Notebooks carry `owner` (a profile id) and `service` (a catalogue entry: its documents and SOPs); `useNotebook(..., scope)` shows the owner's, plus services' for staff; `openServiceNotebook`, `serviceDocuments`. Restricted Mode is `settings.restricted` with `composables/restricted.ts` (`enableRestricted` with a PIN hash, `unlockRestricted`, `sessionEnds`, the idle timer); `FrontDeskSetup.vue` (Preferences → Front desk, staff only), `RestrictedUnlock.vue`. In the shell: session-only notebook storage, `turnNotebook` (the services' documents plus the visit's), `turnCtx()`, Ask Me alone with `frontJourneys` tiles and End session; `App.vue` hides the site chrome and the router sends every address to `/kiosk`.
- The logo (LIB-55): `apps/web/src/assets/logo.svg` (`BrandLogo.vue`) and `public/` (`logo.svg`, `logo-192/512.png`, `apple-touch-icon.png`, `icon-maskable-512.png`, `favicon.ico`, `manifest.webmanifest`); the native app icons and splash screens are made from the same shape.
- Journeys and requests in the conversation (LIB-49..52): the composer's + (attach files to the notebook; /journeys, /staff, /request) and slash suggestions in `TranscriptPane`; `ContextSheet.vue` slides up the list; a pick becomes a turn (`ChatTurn.journey`, `ChatTurn.request`, `chat.addTurns`/`patchTurn`) rendered by `ChatJourney.vue` (an `embedded` `JourneyPanel` resumed from the kept `run`) and `RequestCard.vue` (live status). `KioskShell.startJourney` is the one way to start a journey (Services, the notebook, command cards). Catalogue services live in the Notebook (`CatalogueServices.vue`).
- Kiosk only (KNW-45): in answers "local", an uncovered question calls `POST /api/agent/search` (`kiosk.searchWeb`) and shows `composeWebAnswer` (quoted results with addresses). Model → "Kiosk only (no AI model)" sets that mode.
- Transformers.js runs in module workers (`src/workers/`).

## Notebook, settings, journeys and screens

- **Agent settings** (`schemas` agentSettingsSchema, `settings` capabilities): harness (auto/deep/lean), tool toggles (`flag_for_moderation` is locked on), subagents, memory, skills, MCP server ids, storage. Sent with every turn; `planTurn()` in `agent/index.ts` turns them into `HarnessOptions`. The agent cache key includes them.
- **Notebook** (`notebook/`): sent by the browser each turn and laid out in the deep agent's virtual filesystem: `/notebook/README.md`, `/notebook/sources/<id>.md`, `/memories/AGENTS.md` (Deep Agents `memory`), `/skills/<name>/SKILL.md` (Deep Agents `skills`, from `content/skills`, never from the client). Paths under those roots are rebuilt every turn; a client can't supply them. `search_knowledge_base` also searches the notebook via `config.configurable.notebook`.
- **Storage**: `indexeddb` / `session` keep the conversation in the browser; the core returns it in a `state` event (with updated memory) instead of saving it. `server` saves to the ThreadStore (D1). Client-held threads are validated (`clientThreadSchema`: no system messages, size cap).
- **MCP** (`mcp/`): Streamable HTTP only, servers from the `MCP_SERVERS` env (JSON), tools optionally allowlisted, results wrapped as untrusted data. Never a URL from the visitor.
- **Content** (`packages/yaxb-core/content/`): skills (SKILL.md), journeys (`*.journey.yaml`), services (`*.service.yaml`), `screens.yaml`, and `catalogue/*.service.yaml` (nested services seeded into the Service Catalogue, not built in; `kioskContent.catalogue`, and `journeyById` finds their journeys too). `tools/build-content.mjs` bundles them into `src/data/content.json` (run by `build` and `test`); `src/content` compiles and validates; `content.test.ts` fails on any problem. Journey service names must be in `JOURNEY_SERVICES`; screen components in `SCREEN_COMPONENTS`.
- **Journeys** use clinux-core's step keys (ask/fields, service/with, decide, next, final/result). Conditions and `{{answers.x.y}}` templates are a small safe language (`journeys/expressions.ts`, no eval). The web registers handlers in `KioskShell.tsx`: `agent.ask`, `offline.*` (Transformers.js workers via `lib/browser/offline.ts`), `notebook.add|remember`, `speech.speak`.
- **Screens/layouts** (`screens/`): mini / pod / full chosen by width (`resolveLayout`) or by the visitor; `AdaptiveNav` (yaxb-journeys) is the Vue port of clinux-core's AdaptiveSectionNav (tabs, sidebar, accordion, panes; compact menu under 768px).
- Web browser storage is `lib/browser/store.ts` (IndexedDB or in-memory); documents are read in the browser (`lib/browser/documents.ts`, pdf.js for PDFs).

## Local knowledge search and language

- **Sentence-transformers** (`knowledge/semantic.ts`, export `./knowledge/semantic`): `EMBEDDING_MODELS` has two models, each with calibrated `thresholds`. `minilm` (paraphrase-multilingual-MiniLM-L12-v2, 120 MB, 50 languages) lacks Tamil, Telugu, Kannada, Malayalam and Bengali. `labse` (LaBSE, 470 MB) covers every kiosk language. `knowledge.model` is `auto`|`minilm`|`labse`; `embeddingModelFor(choice, language, question)` picks one, and a question in a script MiniLM lacks always goes to LaBSE. Models run only in the browser (`src/workers/embed.worker.ts` via `lib/browser/offline.ts embedTexts`, search in `lib/browser/semantic.ts`), never in the Worker. The curated Q&A is embedded ahead of time per model into `src/data/curated_embeddings.<model>.ts` (base64 Float32 vectors; `./knowledge/embeddings` `curatedEmbeddingsFor`, loaded on demand; not JSON: a dynamic `import(..., { with: { type: "json" } })` breaks in Vite dev) by `npm run embeddings` (run `npm run build` first). Rerun it after editing `curated_qa.json`; a test fails while any file is stale. `test/fixtures/query-embeddings.json` holds real vectors per model, so the thresholds are tested without the network.
- **Settings → Knowledge** (`agentSettings.knowledge`): `answers` is `agent` (grounded agent, option B), `local` (no model: `composeLocalAnswer` gives the curated answer word for word or quotes notebook sentences, with references, or says "not covered"; escalations go to `POST /api/agent/flag`), or `auto` (local when it matches above `LOCAL_ANSWER_THRESHOLD`, else the agent; local when there's no provider). `semantic` passes on-device matches to the agent as `client.retrieved`. These are references only (`curated:<id>`, `notebook:<id>#<part>` from `semanticChunks`); `resolveRetrieved` looks up the text, and `search_knowledge_base` returns them first via `config.configurable.localKnowledge`.
- Both prompts require facts only, attributed and cited, with no opinions or recommendations.
- **Language** (`agentSettings.language`, `LANGUAGES` in `schemas`): picker on the kiosk header and in Settings. It drives speech in and out, the agent's reply language (`turnPromptAddendum`, which also keeps the `(sources: …)` line in English), and NLLB translation of on-device answers.

## Web fallback, re-ranking, tool routing and slot filling

- **Server sentence-transformer** (`knowledge/server.ts`): `KioskDeps.embed`, defaulting to Workers AI `@cf/baai/bge-m3` over REST (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`; null without them). `SERVER_EMBEDDING.thresholds` are calibrated: `covered` 0.65, `passage` 0.55, `web` 0.5, `route` 0.55 / `routeMargin` 0.12. It powers three things:
  - the coverage check when the browser sent no refs (`createServerIndex` embeds the curated Q&A once per instance);
  - `rerankWeb`;
  - `routeTools`.
- **Web fallback** (`web/index.ts`): `KioskDeps.webSearch`, defaulting to `webSearchFromEnv`. `TAVILY_API_KEY` takes priority over `BRAVE_SEARCH_API_KEY`; `WEB_SEARCH_DOMAINS` is an optional allowlist.
  - In `ask()`, coverage comes from the browser's refs (the browser sends its best refs even when weak) or from the server index.
  - Not covered: the kiosk searches automatically (a `tool_start` event with id `auto-web-search`, name `web_search`), re-ranks, and passes the results as `web:<n>` passages through `localKnowledge`, plus the `web_search` tool.
  - Unknown coverage: only the tool is offered.
  - Never for `looksLikeEmergency`, or with `knowledge.web: "off"`.
  - `configurable.web` (`TurnWeb`) numbers the web ids across the automatic search and tool calls.
- **Tool routing** (`agent/routing.ts`): with more than `ROUTE_LIMIT` (3) MCP tools, only the matching ones go to the deep agent. MCP tools are listed once per server set (`mcpToolsFor`); the agent cache key includes the offered tool names.
- **Slot filling** (`journeys/slots.ts`, after clinux-core `forms/slotFill.js`): `matchFields(fields, text, { embed, meaning, ner, languages })` returns `{ fills, confirm, missing }`. It is a suggestion only; a closed list never takes free text.
  - Passes, in order: label → pattern → entity (NER) → meaning (`MEANING_THRESHOLDS` per model).
  - Fields may carry `description`, `keywords` and `entity`; types now include `number` and `date`.
  - The browser runs it in `lib/browser/slots.ts` (NER: `Xenova/bert-base-multilingual-cased-ner-hrl` in `embed.worker.ts`).
  - The model pass is `kiosk.extract()` / `POST /api/agent/extract`. The server looks the fields up from journey content, `fieldsJsonSchema` is sent as `response_format: json_schema` (Ollama and llama.cpp compile it to a GBNF grammar), and `checkExtracted` validates the result again.
  - UI: the "Say or type it" box in `JourneyPanel.vue`. Example: the check-in journey in `content/catalogue/visits.service.yaml`.
  - `password` fields are never filled (`fillable` skips them), never sent to the model, and are masked in `summarizeRun`.
  - Catalogue journeys: `KioskDeps.journeyFields` (the Worker's `catalogueFields`) looks their fields up in the published catalogue.

## Spell check (SPL-1..7, SPL-10)

- Core `spell/` (export `./spell`): `normalizeText` (NFC, spaces, Indian-script digits), `graphemes` and `editDistance` over `Intl.Segmenter` graphemes, `correctText(text, dict, { protect })` (SymSpell-style deletes; splits only into word pairs the kiosk's texts use, joins only into own words; never numbers, money, phones, emails, web addresses, ids, acronyms, capitalised names mid-sentence or `protect`), `chooseSpelling(originalScore, correctedScore, { strong })` (act, suggest or neither), `spellingHint`. `kioskSpellDictionary()` is built once from content, curated Q&A and command examples; `extendDictionary(dict, ownWords(texts))` adds a tenant's words; `serviceTexts(yaml)`. Corrections land only on own words; `GENERAL_WORDS` (`spell/general.ts`) only marks words as real. `test/fixtures/spell-typos.json` is the SPL-10 set.
- The agent gets the words typed plus `client.spelling` as a hint appended to the human message (SPL-7).
- Web: `lib/browser/spell.ts` `checkSpelling(text, { notebook, services })`. `KioskShell.ask(text, { spoken, unchecked })`: spoken words are never checked; commands try the original, then the correction; the on-device search runs both when its model is ready and keeps the better; the person's turn carries `spelling` (`ChatTurn.spelling`), shown by `TranscriptPane` as "Showing results for … / Search for … instead" or "Did you mean …" (emit `spelling` → `onSpelling`, logged as `spell.corrected`). Slot filling (`matchOnDevice`, `{ spoken }`) keeps the reading that fills more.

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

## Moderators, keys and administration

- `moderators/` (core):
  - `createModeratorService(store)`: `issue` returns `{ moderator, key }`, and that is the only time the key appears. `revoke`, `rotate` and `change` are the other key operations.
  - Signing in checks the key's hash and that it is active and unexpired. `profile` and `saveProfile` handle the moderator profile (`moderatorProfileSchema`: sources must be real knowledge source ids).
  - `auditEvent` keeps short facts only. The audit chain (AUD-2): stores set `prev_hash` and `hash` (`auditHash`, SHA-256 over the facts and the hash before), per tenant from `AUDIT_GENESIS`; writes go one at a time per tenant (`serially`), and D1 inserts only while `audit_heads` still holds the hash it was made from (migration 0015: a trigger moves the head, a unique index refuses a fork). `auditHead`, `auditChain`, `verifyAuditChain`; `GET /api/admin/audit/chain`. Reading the log or a service's trail is audited (`audit.viewed`, AUD-3). Keys are `yaxb_mod_` plus 43 base64url characters (256 bits); `hashKey` is SHA-256 hex.
  - Stores: memory, and D1 (`createD1ModeratorStore`, migration 0004: `moderators`, `moderator_profiles`, `audit`). The D1 store is tested on node:sqlite through a D1-shaped adapter in `test/moderators.test.ts`, which expands `?N` placeholders.
- Worker:
  - `session.ts` `moderatorOf(c, svc)`: the moderator cookie is `<id>.<HMAC over id and current key hash>`, so revoking or rotating a key signs the moderator out; a machine (`c.get("machine")`) comes back with no roles. `MODERATOR_TOKEN` is retired (IDN-44).
  - Members are people or machines (IDN-16, migration 0017): `MACHINE_SCOPES`, `machineMayCall`, `svc.machine(key)` (bearer, `Authorization: Bearer yaxb_mod_…`, checked by the tenant middleware in index.ts: its tenant, its scopes' routes only, `machine.refused` audited; `sameOrigin` passes it), `svc.keyKind`, `svc.linkToAccount` (called when a person starts, joins or adds a space: their key stops signing in). Administration → Add a machine.
  - `isAdmin` and `setAdminCookie` use `ADMIN_TOKEN` (generated by `yaxb.mjs start`).
  - Routes: `/api/moderator` (sign in with a key), `/api/moderator/me` (GET and PUT, profile and activity), `/api/admin` (session), and `/api/admin/moderators[/:id[/revoke|/rotate]]` plus `/api/admin/audit`, all behind one middleware.
- Web: Staff → Administration (`AdminPanel.vue`: issue with the key shown once, revoke, rotate, audit log) and Staff → My profile (`ModeratorProfile.vue`), inside the kiosk.
- Website safety (KNW-25..28):
  - `dohResolver` defaults to Cloudflare's family resolver; an answer of 0.0.0.0 or :: means "blocked as unsafe".
  - `siteGuard({ allow, block, safeBrowsingKey })` runs on every hop. Its settings come from `siteRulesFromEnv`: `WEBSITE_SOURCE_DOMAINS`, `WEBSITE_BLOCKED_DOMAINS` and `SAFE_BROWSING_API_KEY`. If Safe Browsing can't be reached, the page is refused.

## Answer reviews and quality (F1)

- `reviews/` (core, export `./reviews`):
  - `citedRefs(answer)` reads the "(sources: …)" lines; notebook parts count once (`refKey` drops `#n`). The server always derives the cited sources; `answerSubmissionSchema` is strict, so a client can't send them.
  - `newReview` requires every cited source to be marked; missing sources are ids or web addresses (`missingRefKey` → `url:host/path`). A later review names the one it `replaces` and is always timed after it; the latest one counts.
  - `scoreNotebooks`: a row per notebook plus the knowledge-base row (curated sources only; answers that touch one, or have no notebook). `MIN_REVIEWS` (5) or the numbers are null. Weeks are Monday UTC by answer time. `worst` lists answers to look at first.
  - `createReviewService(store, moderatorStore)` counts reviews on the moderator and audits `answer.reviewed` (rating and counts only). Stores: memory and D1 (`createD1ReviewStore`, migration 0005, which also adds the queue's handled state).
- The moderation queue (MOD-4): `ModerationStore.handle` (memory and D1; the CLI's file store has none) and `filterModeration`; `kiosk.moderation(limit, { state, reason })`, `kiosk.handle`.
- Worker: `POST /api/agent/review` (visitor or moderator, same origin, session, form limit) and, behind one moderator middleware, `/api/reviews/answers[/:id]`, `/api/reviews/scores?weeks=`, `/api/reviews/proposals`, `/api/reviews/moderation/:id/handle`. `/api/agent/moderation?state=&reason=`.
- Web: "Ask a moderator to check this answer" under each answer (`TranscriptPane`, `KioskShell.reviewAnswer`), `/kiosk/review` (`AnswerReviews.vue`), `/kiosk/quality` (`QualityDashboard.vue`: sortable table, weeks, worst answers, proposals to copy into `curated_qa.json`), and handled/filters on Curate. `ModeratorSignIn.vue` and `lib/api.ts` are shared.
- Run core tests from PowerShell with an upper-case `C:` path: under Git Bash's `/c/` vitest loads twice and every file fails with "reading 'config'".

## The team: chat and calls

- `team/` (core, export `./team`): `PairingHub` (pairs two members' devices per room, `roomName(a, b, channel)`, relays unread, 4403 outside the pair, 4409 a second device), `Presence` (online members with availability; `invite`/`cancel`/`decline` for chat or video, `unavailable` back when the invitee is offline; anything else ignored), `memberStatus` (invited until the first sign-in, suspended when revoked), `teamMember`, `leavesNoAdministrator` (TEAM-6). The wire protocol is clinux-desk's (`ready`/offer/answer/ice/`peer-left`).
- Moderators: the `administrator` role (such a member may use Administration, like `ADMIN_TOKEN`), `preferences.availability`, `remove` (store and service), `TeamRuleError` for the last-administrator rule (the Worker returns 409).
- Worker: the `TeamHub` Durable Object (`worker/team.ts`, binding `TEAM`, one instance per tenant, `hubName(tenant)`: "team" for the default tenant, TEAM-52) holds both; `GET /api/team`, `PUT /api/team/availability`, and the WebSockets `/api/team/presence` and `/api/team/signal?peer=&channel=`, members with their own key only, same origin. The Worker sets the member and room headers; the browser never chooses them. `Permissions-Policy` allows the camera and screen capture for calls.
- Web: `lib/browser/p2p.ts` (`TeamPresence`, `P2PChat` over a data channel, `P2PVideo` with camera, microphone, screen share; STUN only), `lib/browser/team-chat.ts` (history in IndexedDB per member, never on the server), `composables/team.ts` (one instance: opening a chat invites the other device, which joins on its own; a call rings), `components/team/TeamPanel.vue` (`/kiosk/team`) and `CallLayer.vue` (in `App.vue`, so a call survives page changes). "Share in team chat" on a reviewed answer and the quality page puts a `/kiosk/...` link in the composer; messages show such links as links.
- Not built: team meetings of three or more (RealtimeKit, TEAM-22), the box relay offline (TEAM-30..32), a visitor talking to a person (TEAM-40..42).

## Websites as notebook sources

- `web/pages.ts` (core, export `./web/pages`): `fetchPage` and `fetchSite` (KNW-20..22) guard against SSRF (SEC-4):
  - `urlProblem` allows http(s) only, refuses credentials and odd ports, and refuses local names and private addresses in every spelling (`parseIPv4` handles decimal, hex, octal and short forms; `isPrivateAddress` covers v4, v6 and v4-mapped).
  - `checkResolved` resolves the host first (`dohResolver`, DNS over HTTPS) and refuses it if any address is private.
  - Redirects use `redirect: "manual"`, and every hop is re-checked. Limits: 2 MB (streamed), 10 s.
  - Only HTML, text and Markdown are accepted. `readableText` keeps `<main>`/`<article>` text, drops head, nav and scripts, and turns headings into Markdown.
- Worker: `POST /api/sources/web { url, follow 0..5 }` returns the pages and stores nothing.
- Notebook sources may carry `url` and `fetchedAt`. Their address shows in the notebook README and files, in `resolveRetrieved` passages, in on-device references, and in the closing sources line (`webSourcesLine` now also takes `notebook:<id>` → url).
- Web: NotebookScreen has "Add a website" (with linked pages), shows the address, and has "Read again" (`refreshSource`).

## Kiosk commands

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


## Journeys handed between roles: cases (LIB-12, LIB-33..38)

- **Engine** (yaxb-journeys `journeys.ts`): a step may carry `role` (nested screens: `role:` on a question screen; absent means whoever started the journey). `createRunner(..., { actor: { starter, roles } })` stops at a step its actor can't answer (`status: "waiting"`, `state.waiting`); `snapshot()`, `resume(snap, actor)` and `continueAs(actor)` carry it on. `replay(journey, { answers, steps })` reruns stored answers with recorded service results (no service is called) to find where a run stands. `journeyRolesNeeded`, `mayAnswer`.
- **Core** `cases/` (export `./cases`): `createCaseService(store, { journeyFor })` with `start`, `act`, `note`, `finish`, `list`, `get`. The server replays every change, so the client never decides who is next; the journey is stored with the case. Visibility: starter, members with a role the journey names, administrators. Visitors (`guest:`) open a case only by its reference (`CASE_REF`) and are never listed. Passwords are masked before storing. `staffingOf(roles, members)` (ready / invited / nobody). Stores: memory, D1 `createD1CaseStore` (migration 0009).
- **Worker**: `/api/cases` (POST start, form-limited; GET the queue), `/api/cases/:id|ref` (GET), `/act`, `/notes`, `/finish`; guests are rate limited on every call. `cases(env)` in `worker/kiosk.ts` reads journeys from the published catalogue. `/api/library/published` adds `staffing` and `viewer` (roles).
- **Web**: `JourneyPanel` (`entry` or `resume`) hands over and shows the reference (and the result, when it ends with finishers); `RequestStatus.vue` and `RequestList.vue` (chips and cards), `RequestBoard.vue` (moderators: who has what, Reassign); progress chips come from `progressOf` (yaxb-journeys), so decisions and results never show as chips; warnings use the `caution` utility; `CaseView.vue` (`?screen=services&case=<id|ref>`); the Requests section and the staffing check on load in `ServicesScreen`; `composables/cases.ts`; `library.ts` `kioskActor`, `entryOfJourney`, `needsOf`. The preview's "View as" is in `FlowPreview`/`JourneyRunner`.
- **Where cases are kept** (LIB-42..48): devices first, the cloud last. `CASES_CENTRAL` ("off" by default; "on" only for a paid subscription) enables the central `/api/cases` above (402 otherwise). Without it, cases live on devices: `lib/browser/cases-local.ts` (IndexedDB `yaxb-cases`: cases, events, deliveries; `thisDevice()` keeps a secret, its id is the secret's SHA-256), and `composables/case-network.ts` runs the core's case service over it (`startOnDevice`, `actOnDevice`, `openOnDevice`, `finishOnDevice`, `resend`, `board`, `reassignOnDevices`, `startCaseNetwork`).
  - Hand-over (`cases/transfer.ts`: `Envelope`, `nextAddress`, `receiveCase` replays a case before keeping it; `lib/browser/case-transport.ts` `deliver`): straight to an online member's device (`team.sendData`, data messages beside the chat on the P2P channel, with an ack), else the box (`/v1/mailbox`, kept up to 30 days), else the cloud relay, transient (`/api/relay`, D1 `relay_envelopes`, migration 0011; `CASES_RELAY`, `RELAY_HOURS` 48, at most 168; expired rows deleted on every call, a picked envelope's body deleted at once). The sender keeps its copy and its `Delivery` (delivered, waiting until, expired, not sent) and can resend.
  - Beacons (`Beacon`: reference, titles, role, holder, copies; never answers) on the box or the relay, for moderators' board; `reassign` envelopes go to the devices with a copy. A moderator reassigns without reading the case (`service.reassign`).
  - Settings `cases`: `storage` (devices | central, central only when the server offers it), `useBox`, `useRelay`.

## Household requests in Family (EDN-20..24)

- Core `household/` (export `./household`): `householdSchema` (profile ids, roles `guardian`/`handler`, a child's `guardians`; nothing else), `householdRoles`, `householdProblems`, `householdAllows` (a child's request only to that child's guardians; passed to `createCaseService` as `allows`, which `load` and `list` apply), `HOUSEHOLD_SERVICE_YAML` (the At home service) with `householdBundle`, `householdJourneys`, `householdCaseJourney`, `HOUSEHOLD_ENTRY`. Context feature `household` (Family and the combined site).
- Web: `composables/household.ts` (localStorage `yaxb.household`, `setMember`, `useHousehold`, `householdRecipients`), `components/settings/HouseholdSetup.vue` (Preferences → Household; a guardian edits). `case-network.ts` acts as the open profile (`profile:<id>`) with its household roles, finds household journeys, and keeps household cases on this device (no hand-on, no beacons); `cases.ts` never sends them central. `library.ts` adds the household journeys to `kioskJourneys`, its roles to `kioskActor`, its labels to `roleName`. ServicesScreen shows At home first and refreshes the queue when the profile changes; `startJourney` asks for a profile first.

## Service storage and events (LIB-60..62, MET-1..2)

- **Core** `metrics/` (export `./metrics`): `SERVICE_STORAGE` (none, box, server), `EVENT_KINDS`, `serviceEventSchema` (strict: facts only), `newEvent`, `EventStore` (memory; D1 `createD1EventStore`, migration 0012 `service_events`), `serviceMetrics(events, journeys)` (starts, finishes, completion, hand-overs, open/closed/declined requests, weeks, and per journey a funnel, median time, waits per role, reassignments, failures, forms filled from words) and `activityLog`. Library entries carry `storage` (migration 0012), set by `setEntryStorage` (administrators); `published()` gives each service's `state` and `storage`.
- **Outcomes** (OUT-1..3): `result.outcome` (yaxb-journeys `OUTCOME_ID`, kept by `ServiceDesign`'s `resultOutcome`) comes back in `RunState.result.outcome`; `JourneyPanel` records `journey.outcome` (event field `outcome`); `serviceMetrics` gives `outcomes` per journey and service (labels from `journeys[].outcomes`).
- **Box**: `/v1/events` (POST a batch, GET `?service=&since=`).
- **Worker**: `PUT /api/library/entries/:id/storage` (server needs `CASES_CENTRAL`, the paid plan), `POST /api/events` (only for services stored on the server), `GET /api/events?service=` (administrators, moderators, reviewers).
- **Web**: `composables/service-events.ts` (`recordEvent`, batched, kept offline) fed by `JourneyPanel` (started, screen reached, finished, handed, stopped, step failed, form filled from words, a member's answer) and request actions (`CaseView`: picked up, closed, declined; `RequestBoard`: reassigned). `AddServiceFlow.vue` (Add, People, Storage) in My notebook → Services, and "People and storage" on a loaded service.

## The Scheduler (SCH-1..8)

- **Core** `schedule/` (export `./schedule`): `scheduleItemSchema` (kinds todo, birthday, anniversary, event; `repeat` none/weekly/monthly/yearly; `person`; `owner`), `occurrences(items, from, to, services)` (yearly from 29 February falls on 28 February; `years`), `upcoming(items, today, days, services)` → `{ dated, overdue, undated }`, `parseScheduleText(text, today)` (on-device reading of dates, weekdays, "tomorrow", "next Friday", times), and `SCHEDULE_FORM`/`scheduleFields()`/`draftFromFills` for the model pass: `kiosk.extract()` takes the Scheduler's form and tells the model today's date.
- **Service dates**: nested services may carry `dates: [{ id, title, date: YYYY-MM-DD, time?: HH:MM }]` (yaxb-journeys `serviceDates`, checked in `expandService`); `ServiceDesign.dates` and the "Key dates" fieldset on ServiceDesigner's Service step.
- **Web**: `composables/schedule.ts` (`useSchedule`: IndexedDB `yaxb-schedule`, per profile owner; services' dates from loaded catalogue services; `draft()` reads on the device, then the model; `pendingScheduleText`), `SchedulerScreen.vue` inside Quick tools (`/kiosk?screen=services&tool=scheduler`; the `scheduler` screen in `screens.yaml` is hidden, and its Quick tools item opens the tool), `ComingUp.vue` in Ask Me's empty state. In the composer, `/schedule <words>` and `/qt` (the `ContextSheet` mode `qt`, picks of kind `tool`, `KioskShell.openTool`); neither at the front desk.

## The Legal Guardian: consent (CON-1..8)

- **Package** (yaxb-journeys `consent.ts`): `consent: { version, forms: [{ role, title, points, agree }] }` in nested services (`serviceConsent` validates, called by `expandService`; `consentFormFor(consent, roles, allowed)` picks a person's form, a staff role's own before the visitor's). `ServiceDesign.consent` carries it through the designer untouched.
- **Core** `guardian/` (export `./guardian`): `consentFacts(doc, { storage, relayHours, roles })` (per role: starts, completes, answers, gives, sees, seenBy, toAssistant), `sensitivityOf`, `guardianFlags`, `draftConsent` (plain words, no model), `GUARDIAN_SCHEMA`/`GUARDIAN_PROMPT`/`checkRewrite` (one point for one, or the draft stays). `kiosk.guardian({ yaml, storage, relayHours, roles, selection })` returns `{ consent, facts, flags, via, note }`, raising the version when the wording changes. Stores nothing.
- **Worker**: `POST /api/library/consent { yaml, storage, provider?, model? }` (anyone who may design; chat limiter, form limiter for guests).
- **Web**: the Consent view in `ServiceWorkspace` (`catalogue/ConsentPanel.vue`); `composables/consent.ts` (`useConsent().pending/answer`, localStorage `yaxb.consent` per profile, the visit only at the front desk, events `consent.given`/`consent.declined` with `step: consent-v<n>`); `kiosk/ConsentGate.vue` before a catalogue journey or a resumed part in `JourneyPanel`, and before a finisher's request in `CaseView`.
- **Typed values** (JRN-16): field entities `url`, `money`, `measure` besides `email`/`phone`; `SlotHelpers.values` (core) backed in the browser by `lib/browser/recognizers.ts` (Microsoft Recognizers-Text sequence and number-with-unit, English rules for every language, lazy-loaded).

## Journeys as state machines (JRN-40..44)

- yaxb-journeys `machine.ts` (export `./machine`, and from the root): `journeyMachine(j)` (XState 5: a state per step, each way out its own event: `SUBMIT[.n]`, `DONE[.n]`, `ERROR` → next or `(failed)`, `DECIDE.n`; structure only), `journeyGraph(j)` (`@xstate/graph` `toDirectedGraph`, plus kind, role, depth, reachable; unreached steps get their own rows below), `waysThrough(j)` (shortest path to each ending), `designChecks(j, { roles, order })`. `compileBundle` adds the checks as warnings (screens never reached, loops with no ending, an approval that is a decision nobody is asked for, a role one letter from a known role). The runner (journeys.ts) still runs journeys.
- The Ethics Counsellor's check without a model (ETH-1, ETH-4): yaxb-journeys `ethics.ts` (`ethicsChecks`, `protectedAttributeIn`, `ETHICS_WORDS` in English, Tamil and Hindi). `compileBundle` adds its findings as warnings with `ethics: { severity, attribute }`; the library's `review` refuses an accept with a high finding and no note, and audits the counts; `ServiceWorkspace`'s review form shows the Ethics checklist.
- Vue `FlowDiagram` (SVG, `.yj-fd-*` styles); the web's `catalogue/JourneyFlow.vue` is the workspace's Flow view (diagram, the journey's warnings with their lines, ways through). The designer prompt carries the same rules.

## The organisation (ORG-1..5, 8..9)

- yaxb-journeys `organisation.ts`: `kind: organisation` (`type` business | household | community; `sites`; `units` with `lead`, `roles`, `reports_to`, `services`, `sites`); `compileOrganisation` (a role belongs to one unit, no loops, no HR keys, no reporting lines in a household), `managerOf`, `resolveForRequester`, `needsManager`, `organisationChecks` (ORG-5 warnings), `unitLinks` (ORG-4), `unitTree`. `MANAGER_OF_REQUESTER` (`roles.ts`) is a step role or a finisher, never a starter. `compileBundle` takes organisation documents (`bundle.organisations`, their roles in `bundle.roles`). `templates.ts`: `ORGANISATION_TEMPLATES`, `templatesFor(edition)` (each with starter services; business templates add Time off for the requester's manager).
- Core library: `ENTRY_KINDS` includes `organisation` (one per catalogue, administrators only; migration 0016 rebuilds `library_entries` and `library_revisions`); `published()` returns `organisation` and its roles; `templates`, `applyTemplate`; `memberRoles` option for the staffing check. Cases: `CaseOptions.organisation` resolves `manager-of-requester` at start and keeps the resolved journey. Worker: `GET /api/library/templates`, `POST /api/library/templates/:id` (edition from `SURFACE`).
- Web: `catalogue/OrganisationScreen.vue` (the catalogue's Organisation screen: templates, or the organisation), `catalogue/OrganisationView.vue` (units, who approves for whom, how units work together, warnings), the workspace's Organisation view for organisation entries; `library.ts` `publishedOrganisation`, used by `case-network.ts`.

## My work and service dashboards (WRK-1..2, MET-3..5)

- Staff sections `work` and `dashboards` (yaxb-journeys `STAFF_SECTIONS`, `content/services/staff.service.yaml`; My work opens first). `components/moderation/MyWork.vue`: `caseQueue` (mine, started), `/api/agent/moderation?state=open`, `/api/reviews/answers?state=open`. `components/moderation/ServiceDashboard.vue` (`?service=<entry id>`): `loadEvents(entryId)` in `composables/service-events.ts` (box `/v1/events`, or `/api/events`), core `serviceMetrics` and `activityLog`; single-series bars with their numbers as text.

## Assurance levels (IDN-30..33)

- yaxb-journeys: `ASSURANCE_LEVELS`, `level` on journeys and question steps (nested journeys and screens too; `JourneyDesign.level`, `StepForm.level`), `levelNeeded`, `sureEnough`; `RunActor.level`; the runner's `stepup` state (status `step_up`, `RunState.stepUp`), resumed by `continueAs`. Without an actor nothing steps up (previews, `replay`).
- Core cases: `CaseActor.level` (the Worker's `caseCall` from `c.get("account")?.lvl`, devices' `deviceActor` from `accountLevel`); `start` and `act` refuse answers below a screen's level; `runActor` passes it to the client's runner.
- A business's own sign-in (IDN-15): core `setSpaceOidc`/`spaceOidc`/`spaceOidcProvider`/`removeSpaceOidc` (platform migration 0008, secret sealed), `oidcSignIn({ provider, label, requireEmail })` (provider id `orgProviderId(edition, tenant)`), `oidcStart`/`oidcFinish` for any provider (`localIssuer`: only localhost may be http); routes `/api/identity/space-oidc` (administrator), `/api/identity/org/find|start|callback` (the callback joins them as staff through `deps.joinAsStaff`); `moderation/CompanySignIn.vue`, and "Sign in with your company" in AccountIdentity. `test/oidc.test.ts` runs the flow against a fake provider.
- Signing in on a kiosk by scanning (IDN-19): client `handoff` grants; core `handoffPoll` gives a 30-minute session (`HANDOFF_MINUTES`, `Session.method` "handoff", never renewed past its end) at the approving phone's level; routes `/api/identity/handoff/start|token`; `account/PhoneSignIn.vue` (uqr QR as a `data:` image) in Preferences → Account and on JourneyPanel's step-up card; the front desk's `sessionEnds` signs it out.
- Devices signed in with a code (IDN-17, 18, 41): core `deviceStart`/`deviceRequest`/`deviceApprove`/`devicePoll`/`deviceCredentialOf`/`deviceCredentials`/`revokeDeviceCredential` (platform migration 0006 `device_grants`, `device_credentials`; `DEVICE_CLIENTS`, `DEVICE_SCOPES`); the Worker's `accountContext` takes `Authorization: Bearer anj_dev_…` as the account (`c.get("device")`, only `DEVICE_ROUTES` for its scopes; `clientId` per device; `sameOrigin` passes it); routes `/api/identity/device/start|token|request|approve`, `/api/identity/devices[/self|/:id]`; Preferences → Account → Approve a device (`?device=<code>`) and the devices under Signed in on.
- A space's sign-in rules (IDN-34): core `spacePolicy`/`setSpacePolicy`/`policyAllows` (platform migration 0005 `space_policies`; `TokenClaims.auth_time`); the Worker's `accountContext` applies them to the open space (cached a minute; a refusal is `c.get("spaceRefused")`, shown as `me.refused`), `GET|PUT /api/identity/space-policy` (the space's administrator; never one that would sign them out); `moderation/SignInRules.vue` in Administration.
- Web: `accountLevel` (composables/identity.ts) in `kioskActor`; `JourneyPanel` runs a levelled journey with an actor and shows the step-up card; `identity.whoami`; `?journey=` waits for a catalogue journey to load. JourneyDesigner's level selects. Seed: `content/catalogue/hall.service.yaml`.

## Running journeys on XState; parallel journeys (JRN-45..49)

- yaxb-journeys `run.ts`: `createRunner` runs every journey on an XState actor (sequence: a state per step with `enter`/`asking`/`waiting`/`run`/`route`; a hop counter keeps "went round in circles"). `flow: parallel` (Journey) with `after:` (Step): the tasks are regions of a `tasks` parallel state (pending → ready → active → done), then the first non-task step; `focus(step)`, `RunState.tasks` (`TaskState`), `journeyTasks`, `afterTasks`; `replay` answers tasks in any order. `settle()` waits for running services and focuses this person's first ready task. Nested services take `flow` and screen `after`; `ServiceDesign` keeps them (`JourneyDesign.flow`, `StepForm.after`). Vue `JourneyTasks` in `JourneyRunner` and the web's `JourneyPanel`. `machine.ts` has a parallel graph (`parallelGraph`).

## Sync with the box (SYN-1..6)

- Box: records carry `version`, `deleted`, `seq` (migration 4); `/v2/collections/:name` (GET `?since=`, PUT/DELETE with `baseVersion`, POST `/batch`, `conflict` reject-stale | last-write-wins); collections notebooks, threads, schedule, service-data; v1 writes bump versions, v1 deletes tombstone.
- Core `sync/` (export `./sync`): `applyWrite`, cursors, `createSyncEngine({ remote, shadows, adapters })` (`track`, `sync`, `conflicts`, `resolve(key, "mine" | "theirs")`), `createMemoryShadows`, `boxRemote`; box client `changes` and `batch`.
- Web: Storage "box" is a local IndexedDB copy (`storeFor` → `syncedStore`) whose writes go through `lib/browser/sync-hook.ts` `trackWrite` (also the Scheduler and `library.ts`'s loaded services, `SERVICE_DATA_ID`); `lib/browser/sync-shadows.ts` (IndexedDB `yaxb-sync`); `composables/sync.ts` (`startSync` from App.vue, `syncState`, `syncConflicts`, `resolveConflict`, `syncPulls`); `components/settings/BoxSync.vue` in Preferences → Storage.

## Accounts and spaces (IDN, SPC; docs/specs/15-identity.md step 1)

- Core `identity/` (export `./identity`): `createIdentityService(store, { secret, issuer, rp, sender? })`. Accounts (`display_name` only), methods (`passkey`, `oidc`, `recovery`; `phone`/`email` wait for a provider, IDN-11/12) kept as keyed hashes plus a masked `display`, memberships (spaces: edition, tenant, `space_name`, kind, roles, `member_id`), sessions (ES256 access tokens, `ACCESS_SECONDS`; refresh tokens rotate, a reused one revokes), signing keys rotated every `KEY_ROTATE_DAYS` and sealed with the secret (`jwks()`), counters for limits, `identity_audit`. `methods.ts`: passkeys through SimpleWebAuthn (`passkeyRegisterStart/Finish`, `passkeySignInStart/Finish`, challenges one-use in `otp_challenges`), `oidcSignIn` (verified email only), `newRecoveryCodes`/`recoverySignIn` (level 1), `removeMethod` (keeps one). `oidc.ts`: `oidcStart`/`oidcFinish` (oauth4webapi, PKCE, state, nonce). `crypto.ts` is Web Crypto only. Stores: memory and `createD1IdentityStore` (PLATFORM_DB, `migrations-platform/0002_identity.sql`). Tests: `test/identity.test.ts` with `test/soft-authenticator.ts` (real WebAuthn responses); `sqliteD1({ folder: "migrations-platform" })`.
- Worker `worker/identity.ts`: `accountContext` (every `/api` request: `anj_at` verified, `anj_space` checked against the memberships → `c.get("account")`, `c.get("space")`; the tenant middleware uses the space first), `identityRoutes` at `/api/identity` (config, jwks, passkey register/sign-in, `google/start` and `google/callback`, recovery, me (refreshes), refresh, signout, sessions, methods, account, `space`, `spaces/link`, `spaces/:tenant`). Cookies scoped to `.anjalai.cc` there (DOM-2), host-only elsewhere; relying party `anjalai.cc`, `localhost` locally, none elsewhere (DOM-5). `session.ts` `moderatorOf` falls back to the open space's member (`memberOfSpace`), so the account stands in for the member's key. Settings: `IDENTITY_SECRET` (the same on every edition; `yaxb.mjs` generates one locally), `IDENTITY_ISSUER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- The your-account journey (`content/journeys/your-account.journey.yaml`, Quick tools "Sign in and spaces", `/kiosk?journey=your-account`, the Business player's Account button): handlers `identity.status`, `identity.passkey.signin`, `identity.passkey.create`, `identity.google`, `identity.recovery`, `identity.space.open|start|join` in `KioskShell` (SERVICE_INFO `where: "account"`). A space that opens restarts the app `JOURNEY_RESTART_MS` after the journey reaches its ending; `KioskShell` reopens the conversation (sessionStorage `yaxb.resume.thread`), and `justOpened()` stops a re-run step opening it again. `SpacePicker.vue` ("Where are you today?", SPC-2) after the profile picker, and from the player. A device kept for one space (SPC-5): core `lockDevice`/`deviceLockOf`/`deviceLocks`/`unlockDevice` (platform migration 0004 `device_locks`), the Worker's `anj_lock` cookie read by `accountContext` (`c.get("lock")`, checked once a minute per isolate) wins over the open space for the edition and tenant, `/api/identity/device-lock[s]` (the space's administrator: `spaceAdministrator`), and pages carry `<meta name="yaxb-sections">` (the lock's or the open space's kind, read first by `lib/surface.ts`); FrontDeskSetup's "Keep this device for this space", `useIdentity().locked`, and no space switching while locked. Starting (`/api/identity/spaces/start`: tenant + administrator member + membership) and joining (`/spaces/join`: a join link's request; waiting ones in `pending_joins` are collected on `/me`). New journeys add command examples: `node tools/add-command-embeddings.mjs` adds their MiniLM vectors to `test/fixtures/command-embeddings.json`.
- Web: `composables/identity.ts` (`useIdentity`: passkeys via `@simplewebauthn/browser`, Google redirect, recovery codes, sessions, `openSpace(tenant, edition)` (reloads on the same address, any edition), `linkSpace`), `components/account/AccountIdentity.vue` (Preferences → Account; hidden by the child lock). `lib/surface.ts` `offers()` follows the open space's kind on every address (`rememberSpaceKind`, localStorage `yaxb.space.kind`); `SURFACE` and the brand stay the address's.

## Businesses (tenants) and join links (TEN-1..8)

- Core `tenants/` (export `./tenants`): `createTenantService(store, { issueMember })` (`createTenant`, `directory`, `issueToken` (`autoAccept` only for a new business's first administrator), `tokens`, `revokeToken`, `preview`, `redeem` → claim, `requests`, `decide`, `status`, `collect` → key, made then), memory and D1 stores (migrations 0013, 0014). D1 member and library stores take `{ tenant }` and scope every query (a key hash finds its member anywhere; `library_roles` is keyed by tenant and id); the audit log has a tenant.
- Worker: `tenantContext` (AsyncLocalStorage, `worker/node-modules.d.ts`) set per request from the member cookie (or `?tenant=` on GETs); `moderators(env, tenant)`, `library(env, tenant)`, `reviews(env, tenant)` default to it; sign-in runs in the key's tenant. Routes `/api/directory`, `/api/tenants`, `/api/tenant`, `/api/tenant/join-links[/:id]`, `/api/tenant/join-requests[/:id/decide]`, `/api/join/:token`, `/api/join-requests/:id[/collect]` (claim in `X-Yaxb-Claim`). Web: `moderation/JoinLinks.vue` in Administration, `pages/JoinPage.vue` (`/join/:token`).

## Surfaces (SUR-1..6)

- Core `context/` (export `./context`): `resolveContext({ surface, tenant, jurisdiction })`, `offers`, `servesApi`, `surfaceName` (as clinux-core's; "realm" is kept for the regulatory context).
- One address for every edition (SUR-14): one Worker (`yaxb-web`, `wrangler.jsonc`) and one build serve anjalai.cc, family./business./community.anjalai.cc and yaxb.ai (`routes` with `custom_domain`, DOM-1). `worker/edition.ts`: each `/api` request runs in `editionContext` (`editionFor`: the open space's edition, else the host's via core `surfaceOfHost`, else the `SURFACE` var, else "all"); `db(env)`/`dbFor(env, edition)` map editions to `DB` (yaxb, the portal), `DB_FAMILY`, `DB_BUSINESS`, `DB_COMMUNITY` and never fall back to another; every cache in `kiosk.ts` goes through `scoped()` (edition + tenant); `withEdition` runs work in another edition (starting a space of another kind, collecting a join), `firstEdition` finds a join link's edition (`joinEdition` in index.ts; join routes skip the address's 404 gate). `anj_space` is `<edition>:<tenant>`. The team hub is `hubName(tenant, edition)`. Every database has the same migrations: `db:migrate:local|remote` and `yaxb.mjs` apply all five (with `anjal-platform`). Pages: the Worker writes the address's `<title>`, description and `<meta name="yaxb-edition">` (core `SURFACE_HEADS`, HTMLRewriter). Tests: `npm test` in apps/web (`worker/test`, `vitest.worker.config.ts`, stores on node:sqlite). Locally use http://family.localhost:3000 (etc.). Web `lib/surface.ts` (`offers`, `SURFACE` from the page's meta or the host, `SURFACE_NAME`) gates the router (home page, catalogue, join), navbar, Quick tools, slash commands, Preferences sections, profiles and the child lock; `pages/FamilyHomePage.vue`, `pages/BusinessHomePage.vue`, `pages/CommunityHomePage.vue` (EDN-1..5: Business's features plus profiles and the child lock); `HeroCarousel` shows a surface's slides and features, `IdeasSlides only`. The Worker answers 404 on routes the request's edition lacks.
- The combined build is the Yaxb.ai portal (SUR-7..10): `pages/PortalPage.vue` (platform cards with "Which fits you?", the shared core, what every platform does), `SITE_BRAND` and `PLATFORM_URLS` in `lib/surface.ts` (`VITE_FAMILY_URL`, `VITE_BUSINESS_URL`, `VITE_COMMUNITY_URL`, `VITE_ENTERPRISE_URL`, defaulting to family/business/community.anjalai.cc and clinux.yaxb.ai); the navbar's portal links; the Worker sets each address's title and description (`pageHead` in vite.config.ts only for the native build). The native app is named Anjal.ai.
- Windows builds: vite.config.ts normalises the drive letter (Git Bash's `c:` vs PowerShell's `C:` made two copies of vue-router's keys).

## Journey summaries

- `journeys/summary.ts`:
  - `summarizeJourney` (JRN-20) gives a journey's steps in run order, what it asks for, the services it uses (`SERVICE_INFO`, one entry per `JOURNEY_SERVICES` name, checked by a test), `leavesDevice`, and a one-line `privacy` sentence.
  - `journeysText` goes into the deep agent's offerings (JRN-21).
  - `summarizeRun` (JRN-22) gives the steps, the answers as displayed, the result, and Markdown.
- Web:
  - `JourneySummaryCard.vue`: the info button on each journey item, and "How each service works" on Services.
  - JourneyPanel shows the privacy line, "What this service did" and "Save to notebook".
  - The profile shows question and service counts from the activity log.

## Session feedback

- `feedback/` (core): `feedbackSchema` holds the rating (bad, fine, good or skipped), an optional comment, the mode, language, whether a profile was open, and the answer count. Nothing else. `shouldAskFeedback` (FBK-2), `summarizeFeedback` (MOD-40), `FeedbackStore` (memory, plus D1 `createD1FeedbackStore`, migration 0003). `FEEDBACK_RATE` (0 to 1, default 1/3) is in capabilities.
- Worker: `POST /api/feedback` (same origin, session, form rate limit); `GET /api/agent/feedback` for moderators only.
- Web: `composables/feedback.ts` draws once per browser session (sessionStorage) and queues in localStorage when offline. `FeedbackPrompt.vue` sits under the kiosk header, and `consider()` runs after each answer and its read-aloud. Totals and comments appear on the Curate page.

## Storage (configurable, Deep Agents backends)

The device (STO-1..3): `lib/browser/storage-meter.ts` (`measureStorage`, `askPersistence`, `bytesText`) and `components/settings/StorageMeter.vue` under Preferences → Storage; `App.vue` asks for persistent storage on the native app, an installed app and a front desk. A front desk session's end (`sessionEnds`) also clears the message box (`TranscriptPane`) and the spelling dictionary (`forgetSpelling`).

Settings → Storage: `indexeddb` | `session` | `box` | `server`.
- **Browser / session / box**: the browser keeps notebooks and conversations (`apps/web/src/lib/browser/store.ts`; box = yaxb-box over `@sekaran-ind/yaxb-core/stores/box`). Each turn sends them; the core returns the conversation and memory in the `state` event. The box connection (`settings.box`) stays in localStorage and is never sent to the Worker.
- **Server**: conversations in D1 (`ThreadStore`); the agent's `/memories/` through Deep Agents' `CompositeBackend` → `StoreBackend` over `KvStore` (a LangGraph `BaseStore`, `stores/kv.ts`) on D1 (`createD1Kv`, migration 0002). Namespace `yaxb.memories.<caller>.<notebook>` from `config.configurable.memoryNamespace`; seeded once from the notebook's memory. `harness.ts backendFor()` builds the backend and passes it to the filesystem middleware too (our custom one replaces Deep Agents' default by name, so it must get the backend).
- **CLI**: `YAXB_BOX_URL` + `YAXB_BOX_TOKEN` → conversations and `/memories/` on the box.
- **apps/box** (yaxb-box) checks people offline (IDN-42): `yaxb-box login --site` signs the box in (client `box`); `src/trust.js` keeps its owner's trust (`site.json`, refreshed every five minutes from `/api/identity/box/trust`) and verifies box tokens (core `boxToken`/`boxTrust`, `BOX_TOKEN_DAYS`; Preferences → Storage → Connect with my account) with `node:crypto`; `YAXB_BOX_TOKEN` is optional once the box is signed in. `packages/yaxb-core/test/box-trust.test.ts` checks the site and the box agree.
- **apps/box** (yaxb-box): zero-dependency Node server for a Raspberry Pi: `node:sqlite` in WAL mode, Litestream replica, systemd units, self-signed TLS, bearer token, CORS + Private Network Access only for `YAXB_BOX_ORIGINS`. `node yaxb.mjs box` runs one locally; `node yaxb.mjs box-deploy --host user@pi` installs it on a Pi. The web CSP allows the box via `KIOSK_BOX_ORIGINS` (wrangler `vars`; locally `apps/web/.env.local`).
