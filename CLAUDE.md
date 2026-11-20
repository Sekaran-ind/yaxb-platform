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

## Rules that hold everywhere

- Behaviour changes go in yaxb-core, not in a surface. Changing an `AgentEvent` shape (`events/index.ts`) affects every surface.
- Never put secrets in the client, and never log message content (the moderation queue may hold health details). Never import `stores/node.ts` into the web app.
- Theme tokens only: `bg-surface`/`bg-canvas`/`bg-mist`, `text-ink`/`text-body`/`text-gray-*`, `bg-brand-dark text-on-brand`; never `bg-white` or white text on `bg-brand`. Inside the kiosk, size by the container (`@lg:`, `@2xl:`), not the window. See [web.md](docs/architecture/web.md) and `docs/ux/patterns.md`.
- Destructive actions use `ConfirmAction`, a line of text uses `askText`; never `window.confirm` or `prompt()`. Answers render through `AnswerText.vue`, never `v-html`.
- Tests never call the network: harness tests use `test/scripted-model.ts`; embeddings come from fixtures. Rerun `npm run embeddings` after editing `curated_qa.json`, and regenerate `command-embeddings.json` when the command catalogue or journeys change.
- Windows: run core tests from PowerShell with an upper-case `C:` path; under Git Bash's `/c/` vitest loads twice and every file fails with "reading 'config'". (vite.config.ts normalises the drive letter for builds, since `c:` vs `C:` made two copies of vue-router's keys.)

## Architecture notes

The detail lives in `docs/architecture/`. Read the file for the area you are changing, and keep it current when the structure changes.

| File | Covers |
| --- | --- |
| [core.md](docs/architecture/core.md) | `createKiosk`, `ask()`, the Deep Agents harness and its guards, events, providers, stores |
| [web.md](docs/architecture/web.md) | The Hono Worker, CSP, chat order, the Vue app, themes, KioskShell, the player, Ask Me, forms in the conversation, profiles and the front desk, native mode |
| [notebook.md](docs/architecture/notebook.md) | Agent settings, the notebook in the virtual filesystem, MCP, content bundling, journeys and screens |
| [storage.md](docs/architecture/storage.md) | Storage modes (browser, session, box, server), Deep Agents backends, yaxb-box, sync (SYN) |
| [knowledge.md](docs/architecture/knowledge.md) | On-device sentence-transformers, answer modes, language, the server embedder, web fallback, tool routing, slot filling, websites as sources, approved sites (SIT), spell check (SPL) |
| [commands.md](docs/architecture/commands.md) | Kiosk commands, matching, command cards |
| [people.md](docs/architecture/people.md) | Profiles and the activity log, the child lock (CHL), session feedback |
| [staff.md](docs/architecture/staff.md) | Moderators, keys, machines, the audit chain, answer reviews and quality, the team (chat and calls), My work and dashboards |
| [identity.md](docs/architecture/identity.md) | Accounts and spaces (IDN, SPC), assurance levels and sign-in flows, tenants and join links (TEN), surfaces and editions (SUR) |
| [journeys.md](docs/architecture/journeys.md) | The yaxb-journeys engine and Vue parts, questionnaires, XState machines and parallel journeys, summaries, photos and voice notes, maps, charts and timelines (VIS) |
| [catalogue.md](docs/architecture/catalogue.md) | The Service Catalogue (LIB), the Service Designer agent, consent (CON), the organisation (ORG) |
| [cases.md](docs/architecture/cases.md) | Cases handed between roles, device-first storage and hand-over, dependencies (DEP), household requests |
| [automation.md](docs/architecture/automation.md) | Service events and metrics, routines and hooks (RTN), connectors (CNX), the Scheduler (SCH), attendance (ATT) |
