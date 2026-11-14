# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

This is an npm-workspaces monorepo with one core and several surfaces, the same pattern as clinux-core with clinux-desk, clinux-pro and clinux-diary:

- `packages/yaxb-core` (`@sekaran-ind/yaxb-core`): TypeScript built to `dist/` with `tsc`. It holds the kiosk agent and everything the surfaces share. Behaviour changes go here, not in a surface.
- `packages/yaxb-journeys` (`@sekaran-ind/yaxb-journeys`): Service → Journey → Questionnaire, installable in other projects. It has two parts:
  - A headless engine (tsc → `dist/`): journeys, expressions, fields, questionnaires, services, screens and bundles.
  - Vue components (`vue/`, built with Vite library mode plus vue-tsc → `dist/vue/`, with `style.css`).
  - yaxb-core re-exports the engine as `./journeys`, `./services` and `./screens`, so build this package before the core (`yaxb.mjs` and the core's `pre*` scripts do).
- `apps/web`: a Vue 3 single-page app (Vite, Tailwind 4) served as Workers static assets, plus a Hono Worker (`worker/`) for `/api` that runs yaxb-core's agent. Built and run by `@cloudflare/vite-plugin`.
- `apps/cli`: the `yaxb` command, plain ES modules. Its logic is in `src/cli.js` (`run()` takes an injected `createKiosk`); `src/main.js` wires it up.
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
- The kiosk layout lives in `components/kiosk/KioskShell.vue`, which owns the chat, speech, notebook and journey handlers. Its frame is `components/site/KioskFrame.vue` (shared with the catalogue): Full fills the window wide and tall (panel column, screens scroll inside), Pod is a strip, Mini a fixed-height card. `AdaptiveNav` (from `@sekaran-ind/yaxb-journeys/vue`) renders each screen through a named slot. The kiosk is one frame (SET-14): `PlayerPanel` (slots `meta`, the notebook line via `MarqueeLine`, and `controls`, the `ProfileButton`) and the screens. The profile button opens `KioskPreferences` (which embeds `SettingsPanel`, with a Profile section) in place of the screens, driven by `/kiosk?prefs=<section>`; `/settings` redirects there and there is no settings page. Screens: Transcript, Services, Notebook, Sources. Services (`ServicesScreen.vue`, container queries) includes the *For staff* group (`content/services/staff.service.yaml`; a service item may open `staff: <section>`, `STAFF_SECTIONS` in core services), which shows `KioskStaff.vue` inside Services, with the staff sections in a tabs `AdaptiveNav` (QualityDashboard, AnswerReviews, CurateTimeline, TeamPanel, ModeratorProfile, AdminPanel). No separate staff pages: their old addresses redirect to `/kiosk?screen=services&staff=<section>`. In-section navigation keeps the other query keys.
- The kiosk's screens (LIB-54, `content/screens.yaml`) are labelled Ask Me (`transcript`), Quick tools (`services`) and My notebook (`notebook`); the ids stay. Ask Me has the conversations drawer (`ThreadDrawer.vue`, LIB-53). Requests open in the conversation, unfolded (`RequestCard` → `CaseView embedded`); `/kiosk?case=` and `?load=` are handled by the shell.
- Forms in the conversation (LIB-56): `composables/form-input.ts`. An embedded `JourneyPanel` offers its asking step (`offerFormInput`); `KioskShell.ask()` sends typed or spoken words there first, unless `askInstead`. The kiosk's name is `KIOSK_NAME` in `KioskShell` (LIB-57). Heights (LIB-58): `MINI_HEIGHT`, `POD_HEIGHT` (KioskFrame `podHeight`), Full's `FULL_HEIGHT`. `KioskShell embedded` is Ask Me alone, used by the catalogue's Ask Me screen; `openPrefs` opens `?prefs=` on the current surface, and `CataloguePage` shows `KioskPreferences` for it (LIB-59).
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

## Moderators, keys and administration

- `moderators/` (core):
  - `createModeratorService(store)`: `issue` returns `{ moderator, key }`, and that is the only time the key appears. `revoke`, `rotate` and `change` are the other key operations.
  - Signing in checks the key's hash and that it is active and unexpired. `profile` and `saveProfile` handle the moderator profile (`moderatorProfileSchema`: sources must be real knowledge source ids).
  - `auditEvent` keeps short facts only. Keys are `yaxb_mod_` plus 43 base64url characters (256 bits); `hashKey` is SHA-256 hex.
  - Stores: memory, and D1 (`createD1ModeratorStore`, migration 0004: `moderators`, `moderator_profiles`, `audit`). The D1 store is tested on node:sqlite through a D1-shaped adapter in `test/moderators.test.ts`, which expands `?N` placeholders.
- Worker:
  - `session.ts` `moderatorOf(c, svc)`: the moderator cookie is `<id>.<HMAC over id and current key hash>`, so revoking or rotating a key signs the moderator out. `shared.<HMAC>` is the legacy `MODERATOR_TOKEN`.
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
- Worker: the `TeamHub` Durable Object (`worker/team.ts`, binding `TEAM`, one instance named "team") holds both; `GET /api/team`, `PUT /api/team/availability`, and the WebSockets `/api/team/presence` and `/api/team/signal?peer=&channel=`, members with their own key only, same origin. The Worker sets the member and room headers; the browser never chooses them. `Permissions-Policy` allows the camera and screen capture for calls.
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
- `ConfirmAction` (package) is the one confirmation for destructive actions, in the web and the package; never `window.confirm`. `components/site/SegmentedControl.vue` is the web's segmented control. `ServiceDesigner`'s last step renders the host's `finish` slot (props `ok`, `errors`) and emits `last`. See `docs/ux/patterns.md`.

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
  - `/catalogue` (`pages/CataloguePage.vue`, linked from the navbar and the home page; `/studio` redirects to it) uses the kiosk's `KioskFrame` and layouts (by width); it stays a separate surface (`docs/ux/kiosk-and-catalogue.md`):
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
- **Web**: `DesignerChat.vue` in `ServiceWorkspace` (new services and saved ones): the first message describes the service, later ones ask for changes; a draft goes into the editor with Undo. An uncreated service and its thread are kept in localStorage `yaxb.catalogue.unsaved` ("Start over" clears it).
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

Settings → Storage: `indexeddb` | `session` | `box` | `server`.
- **Browser / session / box**: the browser keeps notebooks and conversations (`apps/web/src/lib/browser/store.ts`; box = yaxb-box over `@sekaran-ind/yaxb-core/stores/box`). Each turn sends them; the core returns the conversation and memory in the `state` event. The box connection (`settings.box`) stays in localStorage and is never sent to the Worker.
- **Server**: conversations in D1 (`ThreadStore`); the agent's `/memories/` through Deep Agents' `CompositeBackend` → `StoreBackend` over `KvStore` (a LangGraph `BaseStore`, `stores/kv.ts`) on D1 (`createD1Kv`, migration 0002). Namespace `yaxb.memories.<caller>.<notebook>` from `config.configurable.memoryNamespace`; seeded once from the notebook's memory. `harness.ts backendFor()` builds the backend and passes it to the filesystem middleware too (our custom one replaces Deep Agents' default by name, so it must get the backend).
- **CLI**: `YAXB_BOX_URL` + `YAXB_BOX_TOKEN` → conversations and `/memories/` on the box.
- **apps/box** (yaxb-box): zero-dependency Node server for a Raspberry Pi: `node:sqlite` in WAL mode, Litestream replica, systemd units, self-signed TLS, bearer token, CORS + Private Network Access only for `YAXB_BOX_ORIGINS`. `node yaxb.mjs box` runs one locally; `node yaxb.mjs box-deploy --host user@pi` installs it on a Pi. The web CSP allows the box via `KIOSK_BOX_ORIGINS` (wrangler `vars`; locally `apps/web/.env.local`).
