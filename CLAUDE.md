# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

This is an npm-workspaces monorepo with one core and several surfaces, the same pattern as clinux-core with clinux-desk, clinux-pro and clinux-diary:

- `packages/yaxb-core` (`@sekaran-ind/yaxb-core`): TypeScript built to `dist/` with `tsc`. It holds the kiosk agent and everything the surfaces share. Behaviour changes go here, not in a surface.
- `apps/web`: a Vue 3 single-page app (Vite, Tailwind 4) served as Workers static assets, plus a Hono Worker (`worker/`) for `/api` that runs yaxb-core's agent. Built and run by `@cloudflare/vite-plugin`.
- `apps/cli`: the `yaxb` command, plain ES modules. Its logic is in `src/cli.js` (`run()` takes an injected `createKiosk`); `src/main.js` wires it up.
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
- Tailwind v4 has no config file. Tokens and reusable classes live in `src/styles.css`, and reusable classes must use `@utility`.
- The kiosk layout lives in `components/kiosk/KioskShell.vue`, which owns the chat, speech, notebook and journey handlers. `AdaptiveNav.vue` renders each screen through a named slot.
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
