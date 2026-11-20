# The core

Part of the architecture notes for Claude Code; the index is in [CLAUDE.md](../../CLAUDE.md).

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
