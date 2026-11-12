// Configurable storage: the LangGraph store behind Deep Agents' StoreBackend, server-side memory,
// and yaxb-box (a real box server, started here on a free port).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript, no types
import { createBoxServer } from "../../../apps/box/src/server.js";
import { createKiosk } from "../src/agent/index.js";
import type { AgentEvent } from "../src/events/index.js";
import { DEFAULT_AGENT_SETTINGS } from "../src/settings/index.js";
import { createBoxClient, createBoxThreadStore } from "../src/stores/box.js";
import { createMemoryModerationStore, createMemoryThreadStore, type ThreadStore } from "../src/stores/index.js";
import { createMemoryKv, KvStore } from "../src/stores/kv.js";
import { ScriptedModel, type Step } from "./scripted-model.js";

const THREAD = "web-abc:0f8fad5b-d9cb-469f-a165-70867728950e";
const SELECTION = { provider: "anthropic", model: "claude-sonnet-5-5", temperature: 0.3 };
const SERVER = { ...DEFAULT_AGENT_SETTINGS, storage: "server" as const };
const NOTEBOOK = { id: "nb1", title: "Knee", memory: "# Notebook memory\n- Answer in short sentences.", sources: [] };
const text = (c: unknown) => (typeof c === "string" ? c : JSON.stringify(c));

async function collect(stream: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

function kioskWith(steps: Step[], { store, threads = createMemoryThreadStore() }: { store: KvStore; threads?: ThreadStore }) {
  const model = new ScriptedModel(steps);
  const errors: unknown[] = [];
  const kiosk = createKiosk({ env: { ANTHROPIC_API_KEY: "k" }, threads, moderation: createMemoryModerationStore(), store, modelFactory: async () => model, onError: (e) => errors.push(e) });
  return { kiosk, model, errors };
}

describe("KvStore (LangGraph BaseStore)", () => {
  it("gets, puts, deletes, searches below a prefix and lists namespaces", async () => {
    const store = new KvStore(createMemoryKv());
    await store.put(["yaxb", "memories", "a", "nb1"], "/AGENTS.md", { content: "x" });
    await store.put(["yaxb", "memories", "a", "nb2"], "/AGENTS.md", { content: "y" });
    await store.put(["other"], "k", { content: "z" });
    expect((await store.get(["yaxb", "memories", "a", "nb1"], "/AGENTS.md"))?.value).toEqual({ content: "x" });
    expect((await store.search(["yaxb", "memories"])).map((i) => i.namespace.at(-1)).sort()).toEqual(["nb1", "nb2"]);
    expect(await store.listNamespaces({ prefix: ["yaxb"] })).toHaveLength(2);
    await store.delete(["other"], "k");
    expect(await store.get(["other"], "k")).toBeNull();
    await expect(store.put(["bad.part"], "k", {})).rejects.toThrow(/namespace/i);
  });
});

describe("server storage: memory in the long-term store (Deep Agents StoreBackend)", () => {
  it("seeds from the notebook, keeps the agent's edits across turns, and returns them", async () => {
    const store = new KvStore(createMemoryKv());
    const { kiosk, model, errors } = kioskWith(
      [
        { calls: [{ name: "edit_file", args: { file_path: "/memories/AGENTS.md", old_string: "- Answer in short sentences.", new_string: "- Answer in short sentences.\n- Prefers Tamil." } }] },
        { text: "Noted." },
        { text: "Vanakkam." },
      ],
      { store },
    );
    const first = await collect(kiosk.ask({ threadId: THREAD, message: "I prefer Tamil", selection: SELECTION, settings: SERVER, client: { thread: null, notebook: NOTEBOOK } }));
    expect(errors).toEqual([]);
    const state = first.find((e) => e.type === "state") as Extract<AgentEvent, { type: "state" }>;
    expect(state.thread).toBeNull(); // the server keeps the conversation
    expect(state.memory).toContain("Prefers Tamil.");

    const saved = await store.get(["yaxb", "memories", "web-abc", "nb1"], "/AGENTS.md");
    expect(String((saved?.value as { content: unknown }).content)).toContain("Prefers Tamil.");

    // Next turn: the browser's copy is stale, the store wins; the memory reaches the prompt.
    await collect(kiosk.ask({ threadId: THREAD, message: "hello", selection: SELECTION, settings: SERVER, client: { thread: null, notebook: { ...NOTEBOOK, memory: "OLD-BROWSER-COPY-7f3" } } }));
    const system = text(model.calls.at(-1)!.find((m) => m.getType() === "system")?.content);
    expect(system).toContain("Prefers Tamil.");

    expect(system).not.toContain("OLD-BROWSER-COPY-7f3");
  });

  it("keeps each caller's memory apart", async () => {
    const store = new KvStore(createMemoryKv());
    await store.put(["yaxb", "memories", "web-other", "nb1"], "/AGENTS.md", { content: "SECRET of another browser", mimeType: "text/markdown", created_at: "", modified_at: "" });
    const { kiosk, model } = kioskWith([{ text: "hi" }], { store });
    await collect(kiosk.ask({ threadId: THREAD, message: "hello", selection: SELECTION, settings: SERVER, client: { thread: null, notebook: NOTEBOOK } }));
    expect(text(model.calls[0]!.find((m) => m.getType() === "system")?.content)).not.toContain("SECRET");
  });
});

describe("yaxb-box", () => {
  const TOKEN = "box-test-token-0123456789-0123456789";
  let box: { listen(): Promise<void>; close(): Promise<void>; address(): { port: number } };
  let dir: string;
  let url: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "yaxb-core-box-"));
    box = createBoxServer({ port: 0, certPort: 0, host: "127.0.0.1", dbPath: join(dir, "box.sqlite3"), token: TOKEN, origins: [], tlsCertPath: "", tlsKeyPath: "" });
    await box.listen();
    url = `http://127.0.0.1:${box.address().port}`;
  });
  afterAll(async () => {
    await box.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("checks the connection and reports a wrong token clearly", async () => {
    expect(await createBoxClient({ url, token: TOKEN }).check()).toBe(true);
    await expect(createBoxClient({ url, token: "wrong-token-wrong-token-wrong-token" }).check()).rejects.toThrow(/token is missing or wrong/);
    expect(() => createBoxClient({ url: "file:///etc", token: TOKEN })).toThrow(/should look like/);
  });

  it("keeps notebooks and conversations for the browser's Box storage", async () => {
    const client = createBoxClient({ url, token: TOKEN });
    await client.put("notebooks", "nb9", { title: "On the box", sources: [], memory: "" });
    await client.put("threads", "t9", { notebookId: "nb9", title: "q", turns: [], state: null });
    expect((await client.get<{ title: string }>("notebooks", "nb9"))?.title).toBe("On the box");
    expect((await client.threadsOf("nb9")).map((t) => t.id)).toEqual(["t9"]);
    await client.delete("notebooks", "nb9");
    expect(await client.get("threads", "t9")).toBeNull();
  });

  it("runs the agent with conversations and memory on the box (CLI, local server)", async () => {
    const client = createBoxClient({ url, token: TOKEN });
    const store = new KvStore(client.kv());
    const threads = createBoxThreadStore(client);
    const { kiosk, model } = kioskWith(
      [
        { calls: [{ name: "write_file", args: { file_path: "/memories/AGENTS.md", content: "# Memory\n- Speaks Hindi" } }] },
        { text: "ok" },
        { text: "Namaste" },
      ],
      { store, threads },
    );
    const cli = "cli:0f8fad5b-d9cb-469f-a165-70867728950e";
    await collect(kiosk.ask({ threadId: cli, message: "remember I speak Hindi", selection: SELECTION, settings: SERVER }));
    expect((await threads.get(cli))?.messages.length).toBeGreaterThan(1);
    expect(JSON.stringify((await client.kv().get("yaxb.memories.cli.default", "/AGENTS.md"))?.value)).toContain("Speaks Hindi");
    await collect(kiosk.ask({ threadId: cli, message: "hi", selection: SELECTION, settings: SERVER }));
    expect(text(model.calls.at(-1)!.find((m) => m.getType() === "system")?.content)).toContain("Speaks Hindi");
  });
});
