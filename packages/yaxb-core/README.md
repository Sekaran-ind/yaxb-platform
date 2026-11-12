# yaxb-core

`@sekaran-ind/yaxb-core` is YAXB's shared core: the kiosk's agent and everything its surfaces must agree on. Each surface stays thin. It parses input, renders events and supplies storage; the behaviour lives here. This follows the same pattern as clinux-core.

The core is headless and DOM-free. It runs in Cloudflare Workers, Node and the browser. The one exception is `/stores/node`, which uses `node:fs`.

| Export | What it is | Used by |
|---|---|---|
| `/agent` | `createKiosk(deps)` is the one entry point, and `ask()` streams `AgentEvent`s. Inside it: the Deep Agents harness (`createKioskAgent`, two subagents, planning, virtual files), the tools, the prompts, the subagent guard and history trimming | web, CLI, later the device gateway |
| `/providers` | The LLM allowlist (`data/providers.json`) plus `listProviders`, `resolveSelection` and `createChatModel`. Keys are read from the env the surface passes in and are never returned | web, CLI |
| `/knowledge` | The curated Q&A and knowledge sources (bundled), `createCuratedRetriever`, `createVectorizeRetriever` (Cloudflare Vectorize with Workers AI embeddings) and `createKnowledgeService` | web, CLI |
| `/events` | The `AgentEvent` protocol and SSE helpers (`toSSEStream`, `readSSE`) | web server and browser, CLI `--json` |
| `/schemas` | The zod request schemas (`chatRequestSchema`, `askSchema`), `MAX_MESSAGE_CHARS` and the thread id pattern | web, CLI |
| `/stores` | The `ThreadStore`, `ModerationStore` and `RateLimiter` contracts, with in-memory implementations | all |
| `/stores/d1` | Those stores on Cloudflare D1 (schema in `migrations/`) | web |
| `/stores/node` | Those stores on files, for Node only | CLI |

## How a surface uses it

```ts
import { createKiosk } from "@sekaran-ind/yaxb-core/agent";
import { createMemoryModerationStore, createMemoryThreadStore } from "@sekaran-ind/yaxb-core/stores";

const kiosk = createKiosk({
  env: process.env,                          // or the Worker env: provider keys live here
  threads: createMemoryThreadStore(),
  moderation: createMemoryModerationStore(),
});

for await (const ev of kiosk.ask({
  threadId: "cli:0f8fad5b-d9cb-469f-a165-70867728950e",   // <namespace>:<uuid>, the surface owns the namespace
  message: "What are the visiting hours?",
  selection: { provider: "anthropic", model: "claude-sonnet-5-5", temperature: 0.3 },
})) {
  // token | tool_start | tool_end | todos, then exactly one done | error
}
```

The surface owns the thread namespace. The web uses an HMAC of the session cookie, so one browser can't reach another's thread. The CLI uses `cli`, and devices will use `device-<id>`.

Thread state (messages, the todo plan and the agent's virtual files) is loaded before a turn and saved only when the turn completes. Old turns are trimmed to fit `Limits`.

## Agent hardening

These layers hold for every provider:

1. **Filesystem allowlist.** Filesystem tools are limited to `SAFE_FS_TOOLS` on the agent and on each subagent, so `execute` and `delete` are never registered.
2. **Subagent guard.** `YaxbSubagentGuard` refuses `task` calls to any subagent other than `knowledge-researcher` and `safety-reviewer`. This covers the general-purpose subagent on providers that Deep Agents has no profile for.
3. **Harness profiles.** Profiles for `anthropic`, `openai` and `google` also hide those tools and disable the general-purpose subagent.
4. **Prompts and limits.** The prompts treat tool output as untrusted data and carry the medical-safety rules. Every run has a recursion limit and a timeout. Errors reach users as generic messages, and `onError` never receives message content.

## Develop

```bash
npm run build      # tsc -> dist/ (surfaces import dist; the runner rebuilds it on start)
npm run dev        # rebuild on change
npm test           # vitest, with a scripted fake model; no network
npm run typecheck
```

`test/scripted-model.ts` is the fake model for harness tests. It replays tool calls and text, streams tokens, and records what it was sent.

To add a provider or model, edit `src/data/providers.json`. Set `"temperature": false` for models that reject a custom temperature. Claude Sonnet and Opus 5.x and GPT-5.x do, and the provider test fails if one is missed.

## Release

The package is set up like clinux-core: private on GitHub Packages, `publishConfig` included, and consumers pin exact versions. While the surfaces live in this repo they use it as a workspace. A change to `AgentEvent`, the request schemas or the stored `ThreadState` affects every surface, so bump the minor version.
