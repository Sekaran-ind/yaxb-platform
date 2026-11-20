# Knowledge, web search, language and spelling

Part of the architecture notes for Claude Code; the index is in [CLAUDE.md](../../CLAUDE.md).

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

## Websites as notebook sources

- `web/pages.ts` (core, export `./web/pages`): `fetchPage` and `fetchSite` (KNW-20..22) guard against SSRF (SEC-4):
  - `urlProblem` allows http(s) only, refuses credentials and odd ports, and refuses local names and private addresses in every spelling (`parseIPv4` handles decimal, hex, octal and short forms; `isPrivateAddress` covers v4, v6 and v4-mapped).
  - `checkResolved` resolves the host first (`dohResolver`, DNS over HTTPS) and refuses it if any address is private.
  - Redirects use `redirect: "manual"`, and every hop is re-checked. Limits: 2 MB (streamed), 10 s.
  - Only HTML, text and Markdown are accepted. `readableText` keeps `<main>`/`<article>` text, drops head, nav and scripts, and turns headings into Markdown.
- Worker: `POST /api/sources/web { url, follow 0..5 }` returns the pages and stores nothing.
- Notebook sources may carry `url` and `fetchedAt`. Their address shows in the notebook README and files, in `resolveRetrieved` passages, in on-device references, and in the closing sources line (`webSourcesLine` now also takes `notebook:<id>` → url).
- Web: NotebookScreen has "Add a website" (with linked pages), shows the address, and has "Read again" (`refreshSource`).

## Approved sites (SIT-1..6)

- Core `sites/` (export `./sites`): `ApprovedSite`, `SiteRequest`, `siteVerdict(url, use, sites, { edition, tenant, family, region })`, `createSiteService` (`request` merged by site and use, `openRequests` without the asker, `approve`/`reject` never by the asker, `addOwn` (no lookups), `switchOff`, `setStatus`, `list`), stores memory and `createD1SiteStore` (platform migration 0009). Worker: `sites(env)` (PLATFORM_DB), `/api/sources/web` checks it (`SITES_ENFORCE` on: 403 with `ask`; off: added, `unapproved`, asked for unless the business switched it off), `/api/sites` (lists; requests for the platform's moderators: `platformModerator`, the portal's administrator or moderating members), `/api/sites/requests[/:id/approve|reject]`, `/api/sites/own`, `/api/sites/:id/status`. Web: NotebookScreen's flag and "Ask to add this site", `moderation/ApprovedSites.vue` in Administration.
- Website access (SIT-5): the seeded service `website-access` (`content/catalogue/website.service.yaml`: add-website, open-site, ask-site) and handlers in `KioskShell` (`web.read` → `/api/sources/web`, kept with `nb.addSource`; `web.link-out` → `POST /api/sites/verdict` with use `link`, then a new tab; `web.request` → `/api/sites/requests`; `web.lookup` refuses until WEB-30); `SERVICE_INFO` marks them `outside` (only the address goes).

## Spell check (SPL-1..7, SPL-10)

- Core `spell/` (export `./spell`): `normalizeText` (NFC, spaces, Indian-script digits), `graphemes` and `editDistance` over `Intl.Segmenter` graphemes, `correctText(text, dict, { protect })` (SymSpell-style deletes; splits only into word pairs the kiosk's texts use, joins only into own words; never numbers, money, phones, emails, web addresses, ids, acronyms, capitalised names mid-sentence or `protect`), `chooseSpelling(originalScore, correctedScore, { strong })` (act, suggest or neither), `spellingHint`. `kioskSpellDictionary()` is built once from content, curated Q&A and command examples; `extendDictionary(dict, ownWords(texts))` adds a tenant's words; `serviceTexts(yaml)`. Corrections land only on own words; `GENERAL_WORDS` (`spell/general.ts`) only marks words as real. `test/fixtures/spell-typos.json` is the SPL-10 set.
- The agent gets the words typed plus `client.spelling` as a hint appended to the human message (SPL-7).
- Web: `lib/browser/spell.ts` `checkSpelling(text, { notebook, services })`. `KioskShell.ask(text, { spoken, unchecked })`: spoken words are never checked; commands try the original, then the correction; the on-device search runs both when its model is ready and keeps the better; the person's turn carries `spelling` (`ChatTurn.spelling`), shown by `TranscriptPane` as "Showing results for … / Search for … instead" or "Did you mean …" (emit `spelling` → `onSpelling`, logged as `spell.corrected`). Slot filling (`matchOnDevice`, `{ spoken }`) keeps the reading that fills more.
