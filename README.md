# YAXB Platform

YAXB is one core with several surfaces, following the pattern of clinux-core and its apps. The kiosk agent and everything the surfaces must agree on live in **yaxb-core**. Each surface only adapts that core to where it runs.

```
packages/yaxb-core     @sekaran-ind/yaxb-core: Deep Agents harness, providers, knowledge, events, stores
apps/web               Vue 3 + Vite + Tailwind 4 SPA, and a Hono Worker for /api, on Cloudflare Workers
apps/cli               `yaxb`: the kiosk agent from a terminal
apps/box               yaxb-box: local storage on a Raspberry Pi (SQLite + Litestream)
apps/esp32-s3-audio    planned voice surface (design notes only)
```

Cübo, the chat assistant in the clinux apps, and the kiosk are meant to unify later. Keeping the agent behind `createKiosk()` and the `AgentEvent` protocol is what makes that possible without touching the surfaces.

## Architecture

```
Browser ──▶ Cloudflare Worker (apps/web, one deploy)
            • Vue app as static assets; security headers + CSP on every page
            • /api/agent/chat ─▶ yaxb-core createKiosk().ask() ─▶ LLM provider (keys = Worker secrets)
            • /api/agent/*  providers, sources, curated, moderation (moderators only)
            • /api/contact → Airtable, /api/newsletter → Mailchimp
            • D1: threads + moderation queue · Rate Limiting bindings · optional Vectorize + Workers AI
In the browser only: speech in/out (Web Speech API), translation and Sandbox (Transformers.js workers)

Terminal ──▶ yaxb CLI ──▶ yaxb-core (same agent; threads in ~/.yaxb)
```

The agent runs inside the Worker, so there's no separate agent service, service token or Python. Users choose the LLM provider and model on `/settings` from the allowlist in `packages/yaxb-core/src/data/providers.json`: Anthropic, OpenAI, Google, Cloudflare Workers AI (gpt-oss, Llama, Mistral), Hugging Face Inference Providers (gpt-oss, Llama, Qwen), Mistral AI, and Ollama (CLI only). Only providers whose key is set can be selected.

## What the kiosk does

- **Ask** by voice or text. A LangChain deep agent answers from the curated knowledge base and the visitor's notebook, with citations, planning, two helper subagents, and escalation to moderators.
- **Notebook**: add documents (text, Markdown, CSV, JSON, HTML, PDF), read in the browser. The agent reads them with its file tools, keeps a per-notebook **memory**, and uses built-in **skills** (`packages/yaxb-core/content/skills`).
- **Services and journeys** (Cübo's model): guided flows authored in YAML that chain the assistant with **offline models** that run on the device: summarise, find an answer, translate. For example, "Prepare a briefing" summarises on the device, writes a plain-language briefing with the assistant, then translates on the device.
- **Settings** for the deep agent: model, harness, tools, subagents, MCP servers, memory, skills, storage (IndexedDB, session only, or server) and layout.
- **Storage you choose**: this browser (IndexedDB), this session only, a **local box** (yaxb-box: a Raspberry Pi with SQLite and Litestream, see [apps/box](apps/box/README.md)), or the server (D1, with the agent's memory in Deep Agents' StoreBackend).
- **Layouts**: mini, pod player and full kiosk, picked from the screen size or by the visitor, with adaptive navigation (tabs, sidebar, accordion).

## Run locally

You need Node 22+. One script does everything on Windows (Command Prompt, PowerShell), macOS and Linux:

```bash
node yaxb.mjs start              # vite dev: the Vue app + the Worker in local workerd, hot reload
node yaxb.mjs start --preview    # the production Worker build on local workerd (wrangler dev)
node yaxb.mjs stop | restart | status | logs
node yaxb.mjs cli chat           # the CLI, using the provider keys in apps/web/.dev.vars
node yaxb.mjs test               # core + CLI tests, web typecheck + lint
node yaxb.mjs deploy             # D1 migrations + Worker deploy
```

The first start installs dependencies, builds yaxb-core, and creates `apps/web/.dev.vars` with a generated `SESSION_SECRET` and `MODERATOR_TOKEN`. It also applies the D1 migrations to the local database in `apps/web/.wrangler/`.

To chat, add at least one provider key, such as `ANTHROPIC_API_KEY`, to `apps/web/.dev.vars`.

## CLI

```bash
node yaxb.mjs cli ask "What should I do if coworkers skip procedures?"
node yaxb.mjs cli ask "and if I want to stay anonymous?" --thread <id printed above>
node yaxb.mjs cli chat --provider openai --model gpt-5.5
node yaxb.mjs cli providers | sources | curated --search gifts | moderation
node yaxb.mjs cli ask "hi" --json      # AgentEvents as JSON lines
```

Installed on its own (`npm i -g ./apps/cli`), `yaxb` reads keys from the environment or from `~/.yaxb/.env`, and keeps conversations in `~/.yaxb`. Ollama works from the CLI, since it needs a local server a Worker can't reach.

## Deploy to Cloudflare

You need the Workers Paid plan: an agent turn needs more CPU than the free plan allows. The bundle is about 2.6 MB gzipped.

```bash
cd apps/web
npx wrangler login
npx wrangler d1 create yaxb                 # put the id in wrangler.jsonc
npx wrangler secret put SESSION_SECRET      # 32+ random characters
npx wrangler secret put ANTHROPIC_API_KEY   # and/or OPENAI_API_KEY, GOOGLE_API_KEY, HF_TOKEN, MISTRAL_API_KEY
npx wrangler secret put MODERATOR_TOKEN     # optional: opens /kiosk/curate to moderators
cd ../.. && node yaxb.mjs deploy
```

For vector search, uncomment the `vectorize` and `ai` bindings in `wrangler.jsonc`. Then ingest documents into the index with `{ text, source }` metadata, embedded with `@cf/baai/bge-base-en-v1.5`. The old Chroma collection must be re-embedded; Vectorize can't read it.

## Security model

- **Secrets stay server-side.** Provider and integration keys are Worker secrets (`.dev.vars` locally). The client bundle has no secrets.
- **Conversations are isolated.** Each browser gets an httpOnly session cookie. Its thread id is `<HMAC(session)>:<uuid>`, so one browser can't read or continue another's conversation. Threads are kept in D1 and expire after 30 days without use.
- **Moderation is private.** The queue holds visitors' escalated questions, which may include health details. Only a browser signed in with `MODERATOR_TOKEN` can read it. The sign-in cookie is httpOnly and SameSite=Strict, and rotating the token signs everyone out.
- **Input is validated** with zod at the route and again in the core. Strict schemas, length limits and ID patterns apply, and the provider and model must be on the allowlist and configured.
- **Abuse limits.** Workers Rate Limiting caps chat per session and forms per IP. POST routes check same-origin, and the contact form has a honeypot.
- **Agent hardening.** There is no shell or delete tool, and delegation is allowed only to the two declared subagents. Files are virtual and kept in thread state. Tool output is treated as untrusted. Each run has a recursion limit and a timeout. See [packages/yaxb-core/README.md](packages/yaxb-core/README.md).
- **Headers.** Strict nonce-based CSP, HSTS, `X-Frame-Options: DENY`, and a Permissions-Policy that allows only the microphone. `global_fetch_strictly_public` stops the Worker reaching private networks.
- **Logs.** Message content is never logged.

## Migration notes

| Before | Now |
| --- | --- |
| Python FastAPI agent (`agent/`) + Next.js BFF with a service token | yaxb-core (TypeScript Deep Agents) running inside the Worker |
| `InMemorySaver` checkpointer | Thread state in D1 (web) or files (CLI), saved per completed turn |
| In-process rate limiter and moderation queue | Workers Rate Limiting bindings, and the moderation queue in D1 |
| Chroma vector store | Cloudflare Vectorize (optional), and curated Q&A always |
| Next.js 16 + React on OpenNext (3.0 MB Worker) | Vue 3 SPA as static assets + Hono Worker (1.4 MB Worker); provider SDKs cut to Anthropic + OpenAI |
| `web/.env.local`, `agent/.env` | `apps/web/.dev.vars` locally, Worker secrets in production |
