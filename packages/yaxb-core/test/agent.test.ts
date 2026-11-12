import { describe, expect, it } from "vitest";
import { createKiosk, looksLikeEmergency, trimHistory, type KioskDeps } from "../src/agent/index.js";
import type { AgentEvent } from "../src/events/index.js";
import { createMemoryModerationStore, createMemoryThreadStore } from "../src/stores/index.js";
import { ScriptedModel, type Step } from "./scripted-model.js";

const THREAD = "test:0f8fad5b-d9cb-469f-a165-70867728950e";
const SELECTION = { provider: "anthropic", model: "claude-sonnet-5-5", temperature: 0.3 };

function setup(steps: Step[], overrides: Partial<KioskDeps> = {}) {
  const model = new ScriptedModel(steps);
  const threads = createMemoryThreadStore();
  const moderation = createMemoryModerationStore();
  const errors: unknown[] = [];
  const base = createKiosk({
    env: { ANTHROPIC_API_KEY: "test-key" },
    threads,
    moderation,
    modelFactory: async () => model,
    onError: (e) => errors.push(e),
    ...overrides,
  });
  // These tests keep conversations on the server unless they say otherwise.
  const kiosk = { ...base, ask: (input: Parameters<typeof base.ask>[0], o?: Parameters<typeof base.ask>[1]) => base.ask({ settings: { storage: "server" }, ...input }, o) };
  return { kiosk, raw: base, model, threads, moderation, errors };
}

async function collect(stream: AsyncIterable<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

const answerOf = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "token" ? [e.text] : [])).join("");

describe("kiosk agent", () => {
  it("streams tool use, then the answer, then done; and saves the thread", async () => {
    const { kiosk, threads, errors } = setup([
      { calls: [{ name: "search_knowledge_base", args: { query: "procedure shortcut quality" } }] },
      { text: "Raise it with your supervisor (sources: curated:qa-001)." },
    ]);
    const events = await collect(kiosk.ask({ threadId: THREAD, message: "Coworkers skip procedures", selection: SELECTION }));

    expect(errors).toEqual([]);
    const start = events.find((e) => e.type === "tool_start");
    expect(start).toMatchObject({ name: "search_knowledge_base", nested: false });
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({ name: "search_knowledge_base" });
    expect(answerOf(events)).toBe("Raise it with your supervisor (sources: curated:qa-001).");
    expect(events.filter((e) => e.type === "token").length).toBeGreaterThan(1);
    expect(events.at(-1)).toEqual({ type: "done" });

    const saved = await threads.get(THREAD);
    expect(saved?.messages.map((m) => m.type)).toEqual(["human", "ai", "tool", "ai"]);
    expect(String(saved?.messages[2]?.data.content)).toContain("source=curated:qa-001");
  });

  it("gives the model the earlier turns on the next ask", async () => {
    const { kiosk, model } = setup([{ text: "Hello." }, { text: "You said hi." }]);
    await collect(kiosk.ask({ threadId: THREAD, message: "hi", selection: SELECTION }));
    await collect(kiosk.ask({ threadId: THREAD, message: "what did I say?", selection: SELECTION }));
    const human = model.calls[1]!.filter((m) => m.getType() === "human").map((m) => m.content);
    expect(human).toEqual(["hi", "what did I say?"]);
  });

  it("escalates a possible emergency even when the model doesn't", async () => {
    const { kiosk, moderation } = setup([{ text: "Please call your local emergency number now." }]);
    const events = await collect(kiosk.ask({ threadId: THREAD, message: "I have crushing chest pain right now", selection: SELECTION }));
    expect(events[0]).toMatchObject({ type: "tool_start", name: "flag_for_moderation" });
    expect(await moderation.list()).toMatchObject([{ question: "I have crushing chest pain right now", reason: expect.stringMatching(/emergency/) }]);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("recognises emergencies without flagging ordinary questions", () => {
    for (const m of ["I can't breathe", "my dad might be having a stroke", "I want to kill myself", "she took an overdose", "severe bleeding from a cut"])
      expect(looksLikeEmergency(m), m).toBe(true);
    for (const m of ["Can I accept a gift from a supplier?", "What are the visiting hours?", "how do I book a blood test"])
      expect(looksLikeEmergency(m), m).toBe(false);
  });

  it("runs lean-harness models with only the three kiosk tools", async () => {
    const { kiosk, model, threads } = setup(
      [{ calls: [{ name: "search_knowledge_base", args: { query: "supplier gift" } }] }, { text: "Return it if it isn't modest (sources: curated:qa-020)." }],
      { env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } },
    );
    const selection = { provider: "ollama", model: "llama3.1:8b", temperature: 0.3 };
    const events = await collect(kiosk.ask({ threadId: THREAD, message: "Can I accept a gift?", selection }));
    expect([...new Set(model.boundTools.flat())].sort()).toEqual(["flag_for_moderation", "list_knowledge_sources", "search_knowledge_base"]);
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({ name: "search_knowledge_base" });
    expect(answerOf(events)).toContain("curated:qa-020");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect((await threads.get(THREAD))?.messages.map((m) => m.type)).toEqual(["human", "ai", "tool", "ai"]);
  });

  it("never offers execute or delete, on the agent or its subagents", async () => {
    const { kiosk, model } = setup([
      { calls: [{ name: "task", args: { subagent_type: "knowledge-researcher", description: "find the helpline" } }] },
      { text: "Brief: use the helpline (curated:qa-001)." },
      { text: "Call the helpline." },
    ]);
    await collect(kiosk.ask({ threadId: THREAD, message: "helpline?", selection: SELECTION }));
    const all = model.boundTools.flat();
    expect(all).toContain("write_todos");
    expect(all).toContain("read_file");
    expect(all).toContain("search_knowledge_base");
    expect(all).not.toContain("execute");
    expect(all).not.toContain("delete");
  });

  it("delegates to a declared subagent and reports it", async () => {
    const { kiosk } = setup([
      { calls: [{ name: "task", args: { subagent_type: "knowledge-researcher", description: "find the helpline" } }] },
      { text: "Brief: use the helpline (curated:qa-001)." },
      { text: "Call the helpline." },
    ]);
    const events = await collect(kiosk.ask({ threadId: THREAD, message: "helpline?", selection: SELECTION }));
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({ name: "task", subagent: "knowledge-researcher" });
    expect(answerOf(events)).toBe("Call the helpline.");
  });

  it("refuses delegation to any subagent that isn't declared", async () => {
    const { kiosk, model } = setup([
      { calls: [{ name: "task", args: { subagent_type: "general-purpose", description: "run a shell" } }] },
      { text: "I can't do that." },
    ]);
    const events = await collect(kiosk.ask({ threadId: THREAD, message: "x", selection: SELECTION }));
    expect(events.at(-1)).toEqual({ type: "done" });
    const toolReply = model.calls[1]!.find((m) => m.getType() === "tool");
    expect(String(toolReply?.content)).toContain('No helper named "general-purpose"');
    expect(model.calls).toHaveLength(2); // no subagent model call happened
  });

  it("records escalations in the moderation store", async () => {
    const { kiosk, moderation } = setup([
      { calls: [{ name: "flag_for_moderation", args: { question: "refund outside policy", reason: "not in the knowledge base" } }] },
      { text: "I have passed this to a moderator." },
    ]);
    await collect(kiosk.ask({ threadId: THREAD, message: "Can I get a refund outside the policy?", selection: SELECTION }));
    expect(await moderation.list()).toMatchObject([{ question: "refund outside policy", reason: "not in the knowledge base" }]);
  });

  it("returns a safe error for a provider that isn't configured, without calling a model", async () => {
    const { kiosk, model } = setup([{ text: "unused" }]);
    const events = await collect(
      kiosk.ask({ threadId: THREAD, message: "hi", selection: { provider: "openai", model: "gpt-5.5", temperature: 0.3 } }),
    );
    expect(events).toEqual([{ type: "error", message: "OpenAI is not configured. Add its key to enable it." }]);
    expect(model.calls).toHaveLength(0);
  });

  it("rejects malformed thread ids and models off the allowlist", async () => {
    const { kiosk } = setup([]);
    expect(await collect(kiosk.ask({ threadId: "no-namespace", message: "hi", selection: SELECTION }))).toEqual([
      { type: "error", message: "That request isn't valid." },
    ]);
    const [e] = await collect(kiosk.ask({ threadId: THREAD, message: "hi", selection: { ...SELECTION, model: "made-up" } }));
    expect(e).toMatchObject({ type: "error", message: expect.stringContaining("not offered") });
  });

  it("reports a model failure generically and keeps the thread unchanged", async () => {
    const { kiosk, threads, errors } = setup([], {
      modelFactory: async () => {
        const m = new ScriptedModel([]);
        m._streamResponseChunks = async function* () {
          throw new Error("upstream 500 with secret details");
        };
        m._generate = async () => {
          throw new Error("upstream 500 with secret details");
        };
        return m;
      },
    });
    const events = await collect(kiosk.ask({ threadId: THREAD, message: "hi", selection: SELECTION }));
    expect(events.at(-1)).toEqual({ type: "error", message: "The assistant is unavailable right now. Please try again." });
    expect(JSON.stringify(events)).not.toContain("secret");
    expect(errors).toHaveLength(1);
    expect(await threads.get(THREAD)).toBeNull();
  });
});

describe("trimHistory", () => {
  const msg = (type: string, content = "x") => ({ type, data: { content, role: undefined, name: undefined, tool_call_id: undefined } });
  it("keeps whole turns, starting at a human message", () => {
    const history = [msg("human"), msg("ai"), msg("tool"), msg("ai"), msg("human"), msg("ai")];
    expect(trimHistory(history, { maxStoredMessages: 3, maxStoredBytes: 1e6 }).map((m) => m.type)).toEqual(["human", "ai"]);
    expect(trimHistory(history, { maxStoredMessages: 10, maxStoredBytes: 1e6 })).toHaveLength(6);
  });
  it("trims by size", () => {
    const history = [msg("human", "a".repeat(500)), msg("ai"), msg("human"), msg("ai")];
    expect(trimHistory(history, { maxStoredMessages: 10, maxStoredBytes: 300 }).map((m) => m.type)).toEqual(["human", "ai"]);
  });
});
