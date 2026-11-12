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
- The kiosk layout lives in `components/kiosk/KioskShell.vue`, which owns the chat, speech, notebook and journey handlers. `AdaptiveNav.vue` renders each screen through a named slot. The kiosk is one frame (SET-14): `PlayerPanel` (slots `meta`, the notebook line via `MarqueeLine`, and `controls`, the `ProfileButton`) and the screens. The profile button opens `KioskPreferences` (which embeds `SettingsPanel`, with a Profile section) in place of the screens, driven by `/kiosk?prefs=<section>`; `/settings` redirects there and there is no settings page. Screens: Transcript, Services, Notebook, Sources. Services (`ServicesScreen.vue`, container queries) includes the *For staff* group (`content/services/staff.service.yaml`; a service item may open `staff: <section>`, `STAFF_SECTIONS` in core services), which shows `KioskStaff.vue` inside Services (QualityDashboard, AnswerReviews, CurateTimeline, TeamPanel, ModeratorProfile, AdminPanel). No separate staff pages: their old addresses redirect to `/kiosk?screen=services&staff=<section>`. In-section navigation keeps the other query keys.
- Kiosk only (KNW-45): in answers "local", an uncovered question calls `POST /api/agent/search` (`kiosk.searchWeb`) and shows `composeWebAnswer` (quoted results with addresses). Model → "Kiosk only (no AI model)" sets that mode.
- Transformers.js runs in module workers (`src/workers/`).

## Notebook, settings, journeys and screens

- **Agent settings** (`schemas` agentSettingsSchema, `settings` capabilities): harness (auto/deep/lean), tool toggles (`flag_for_moderation` is locked on), subagents, memory, skills, MCP server ids, storage. Sent with every turn; `planTurn()` in `agent/index.ts` turns them into `HarnessOptions`. The agent cache key includes them.
- **Notebook** (`notebook/`): sent by the browser each turn and laid out in the deep agent's virtual filesystem: `/notebook/README.md`, `/notebook/sources/<id>.md`, `/memories/AGENTS.md` (Deep Agents `memory`), `/skills/<name>/SKILL.md` (Deep Agents `skills`, from `content/skills`, never from the client). Paths under those roots are rebuilt every turn; a client can't supply them. `search_knowledge_base` also searches the notebook via `config.configurable.notebook`.
- **Storage**: `indexeddb` / `session` keep the conversation in the browser; the core returns it in a `state` event (with updated memory) instead of saving it. `server` saves to the ThreadStore (D1). Client-held threads are validated (`clientThreadSchema`: no system messages, size cap).
- **MCP** (`mcp/`): Streamable HTTP only, servers from the `MCP_SERVERS` env (JSON), tools optionally allowlisted, results wrapped as untrusted data. Never a URL from the visitor.
- **Content** (`packages/yaxb-core/content/`): skills (SKILL.md), journeys (`*.journey.yaml`), services (`*.service.yaml`), `screens.yaml`. `tools/build-content.mjs` bundles them into `src/data/content.json` (run by `build` and `test`); `src/content` compiles and validates; `content.test.ts` fails on any problem. Journey service names must be in `JOURNEY_SERVICES`; screen components in `SCREEN_COMPONENTS`.
- **Journeys** use clinux-core's step keys (ask/fields, service/with, decide, next, final/result). Conditions and `{{answers.x.y}}` templates are a small safe language (`journeys/expressions.ts`, no eval). The web registers handlers in `KioskShell.tsx`: `agent.ask`, `offline.*` (Transformers.js workers via `lib/browser/offline.ts`), `notebook.add|remember`, `speech.speak`.
- **Screens/layouts** (`screens/`): mini / pod / full chosen by width (`resolveLayout`) or by the visitor; `AdaptiveNav.vue` is the Vue port of clinux-core's AdaptiveSectionNav (tabs, sidebar, accordion, panes; compact menu under 768px).
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
  - UI: the "Say or type it" box in `JourneyPanel.vue`. Example: `visit-check-in.journey.yaml`.

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
  - Components: `AdaptiveNav` (the kiosk's, plus `lockMode`), `QuestionnaireForm` (sections as nav screens), `JourneyRunner`, `ServiceItems`, `FlowPreview`, `StructureTree`, `FlowStudio`.
  - Plain CSS with `.yj` and `--yj-*` tokens. The defaults are in `:where()`, and `apps/web/src/styles.css` maps them to the site's theme tokens.
  - Icons come from the host via `provideIcons`.
- **Portal**: `/studio` (`pages/StudioPage.vue`, navbar "Journey studio") checks against `JOURNEY_SERVICES` and the kiosk's screen ids.
- The kiosk still has its own `components/kiosk/AdaptiveNav.vue` (Tailwind). Moving it to the package's is open, and needs a visual check.

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
