import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSSE, toSSEStream, type AgentEvent } from "../src/events/index.js";
import { createCuratedRetriever, createKnowledgeService, createVectorizeRetriever } from "../src/knowledge/index.js";
import { catalog, createChatModel, defaultSelection, HF_ROUTER_URL, listProviders, resolveSelection, workersAiUrl } from "../src/providers/index.js";
import { chatRequestSchema } from "../src/schemas/index.js";
import { createD1ModerationStore, createD1ThreadStore, type D1Like } from "../src/stores/d1.js";
import { createMemoryRateLimiter } from "../src/stores/index.js";
import { createFileModerationStore, createFileThreadStore } from "../src/stores/node.js";

describe("providers", () => {
  it("marks only providers with credentials as configured, and never returns keys", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-secret", OPENAI_API_KEY: "  " };
    const res = listProviders(env);
    expect(res.providers.find((p) => p.id === "anthropic")?.configured).toBe(true);
    expect(res.providers.find((p) => p.id === "openai")?.configured).toBe(false);
    expect(JSON.stringify(res)).not.toContain("sk-ant-secret");
  });
  it("falls back to the first configured provider when the default isn't set up", () => {
    expect(defaultSelection({ GOOGLE_API_KEY: "g" })).toEqual({ provider: "google_genai", model: "gemini-2.5-pro" });
  });
  it("refuses unknown providers and models", () => {
    expect(() => resolveSelection({}, { provider: "nope", model: "x" })).toThrow(/Unknown provider/);
    expect(() => resolveSelection({ ANTHROPIC_API_KEY: "k" }, { provider: "anthropic", model: "gpt-5.5" })).toThrow(/not offered/);
  });
  it("builds every catalog model with parameters its provider package accepts", async () => {
    const env = {
      ANTHROPIC_API_KEY: "k",
      OPENAI_API_KEY: "k",
      GOOGLE_API_KEY: "k",
      HF_TOKEN: "hf_k",
      MISTRAL_API_KEY: "k",
      CLOUDFLARE_API_TOKEN: "cf",
      CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    };
    for (const p of catalog.providers) {
      for (const m of p.models) {
        const model = await createChatModel(env, { provider: p.id, model: m.id, temperature: 0.3 });
        // The provider packages validate sampling parameters when building a request.
        const params = (model as unknown as { invocationParams: (o?: unknown) => Record<string, unknown> }).invocationParams({});
        if (m.temperature === false) expect(params.temperature, `${p.id}/${m.id}`).toBeUndefined();
      }
    }
  });

  it("sends Hugging Face models to the router with the HF token", async () => {
    const model = await createChatModel({ HF_TOKEN: "hf_k" }, { provider: "huggingface", model: "openai/gpt-oss-120b:groq", temperature: 0.3 });
    const m = model as unknown as { clientConfig: { baseURL?: string; apiKey?: string }; model: string };
    expect(m.clientConfig.baseURL).toBe(HF_ROUTER_URL);
    expect(m.clientConfig.apiKey).toBe("hf_k");
    expect(m.model).toBe("openai/gpt-oss-120b:groq");
  });

  it("needs both the Cloudflare token and account id for Workers AI, and builds its URL safely", async () => {
    const sel = { provider: "workers_ai", model: "@cf/openai/gpt-oss-120b", temperature: 0.3 };
    const account = "0123456789abcdef0123456789abcdef";
    expect(listProviders({ CLOUDFLARE_API_TOKEN: "cf" }).providers.find((p) => p.id === "workers_ai")?.configured).toBe(false);
    expect(() => resolveSelection({ CLOUDFLARE_API_TOKEN: "cf" }, sel)).toThrow(/not configured/);
    const model = await createChatModel({ CLOUDFLARE_API_TOKEN: "cf", CLOUDFLARE_ACCOUNT_ID: account }, sel);
    const m = model as unknown as { clientConfig: { baseURL?: string; apiKey?: string } };
    expect(m.clientConfig.baseURL).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`);
    expect(m.clientConfig.apiKey).toBe("cf");
    await expect(createChatModel({ CLOUDFLARE_API_TOKEN: "cf", CLOUDFLARE_ACCOUNT_ID: "evil.example/x?" }, sel)).rejects.toThrow(/32-character/);
    expect(workersAiUrl(account)).toContain(account);
  });

  it("offers only tool-capable Hugging Face routes, pinned to an inference provider", () => {
    for (const m of catalog.providers.find((p) => p.id === "huggingface")!.models) expect(m.id).toMatch(/^[\w.-]+\/[\w.-]+:[a-z-]+$/);
  });
});

describe("knowledge", () => {
  it("finds curated answers by keyword overlap and marks red flags", async () => {
    const results = await createCuratedRetriever().search("procedure documents shortcut", 2);
    expect(results[0]?.source).toBe("curated:qa-001");
    expect(results[0]?.content).toMatch(/^Q: /);
  });
  it("puts vector passages first and survives a vector failure", async () => {
    const vector = { search: async () => [{ source: "kb:1", content: "v", score: 0.9, redFlag: false }] };
    const ok = await createKnowledgeService({ vector }).search("procedure", 2);
    expect(ok[0]?.source).toBe("kb:1");
    const errors: unknown[] = [];
    const broken = createKnowledgeService({ vector: { search: async () => Promise.reject(new Error("down")) }, onError: (e) => errors.push(e) });
    expect((await broken.search("procedure", 2)).every((p) => p.source.startsWith("curated:"))).toBe(true);
    expect(errors).toHaveLength(1);
  });
  it("maps Vectorize matches with metadata to passages", async () => {
    const r = createVectorizeRetriever({
      ai: { run: async () => ({ data: [[0.1, 0.2]] }) },
      index: {
        query: async () => ({
          matches: [
            { id: "a", score: 0.8, metadata: { text: "Fasting before a lipid test", source: "diagnostics:12" } },
            { id: "b", score: 0.2, metadata: { text: "low score" } },
          ],
        }),
      },
    });
    expect(await r.search("lipid", 3)).toEqual([{ source: "diagnostics:12", content: "Fasting before a lipid test", score: 0.8, redFlag: false }]);
  });
});

describe("events", () => {
  it("round-trips events through SSE", async () => {
    const sent: AgentEvent[] = [{ type: "token", text: "héllo\nworld" }, { type: "done" }];
    async function* gen() {
      yield* sent;
    }
    const got: AgentEvent[] = [];
    for await (const e of readSSE(toSSEStream(gen()))) got.push(e);
    expect(got).toEqual(sent);
  });
});

describe("schemas", () => {
  it("rejects unknown fields and over-long messages", () => {
    const ok = { threadId: crypto.randomUUID(), message: "hi", provider: "anthropic", model: "claude-sonnet-5-5" };
    expect(chatRequestSchema.safeParse(ok).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...ok, provider: "workers_ai", model: "@cf/openai/gpt-oss-20b" }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...ok, model: "a@b" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...ok, message: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("stores", () => {
  it("file stores keep threads and moderation items", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yaxb-core-"));
    try {
      const threads = createFileThreadStore(join(dir, "threads"));
      await threads.put("cli:x", { messages: [], todos: [], files: {} });
      expect(await threads.get("cli:x")).toEqual({ messages: [], todos: [], files: {} });
      expect(await threads.get("cli:missing")).toBeNull();
      const mod = createFileModerationStore(join(dir, "moderation.jsonl"));
      await mod.add("q1", "r1");
      await mod.add("q2", "r2");
      expect((await mod.list()).map((i) => i.question)).toEqual(["q2", "q1"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("D1 stores issue parameterised SQL", async () => {
    const seen: { sql: string; values: unknown[] }[] = [];
    const db: D1Like = {
      prepare(sql) {
        const stmt = {
          values: [] as unknown[],
          bind(...v: unknown[]) {
            stmt.values = v;
            return stmt;
          },
          async first<T>() {
            seen.push({ sql, values: stmt.values });
            return { state: JSON.stringify({ messages: [], todos: [], files: {} }) } as T;
          },
          async all<T>() {
            seen.push({ sql, values: stmt.values });
            return { results: [] as T[] };
          },
          async run() {
            seen.push({ sql, values: stmt.values });
            return {};
          },
        };
        return stmt;
      },
    };
    await createD1ThreadStore(db).put("web:t", { messages: [], todos: [], files: {} });
    await createD1ModerationStore(db).add("q'; DROP TABLE x;--", "r");
    expect(seen.every((s) => !s.sql.includes("DROP"))).toBe(true);
    expect(seen.some((s) => s.values.includes("q'; DROP TABLE x;--"))).toBe(true);
  });

  it("memory rate limiter allows `limit` calls per window per key", async () => {
    const rl = createMemoryRateLimiter({ limit: 2, windowMs: 1000 });
    expect([await rl.limit("a"), await rl.limit("a"), await rl.limit("a"), await rl.limit("b")]).toEqual([true, true, false, true]);
  });
});

describe("OpenAI-compatible endpoints that want string content", () => {
  it("joins text blocks into one string and leaves other content alone", async () => {
    const { flattenTextContent, plainTextContentFetch } = await import("../src/providers/index.js");
    const body = {
      model: "m",
      messages: [
        { role: "system", content: [{ type: "text", text: "You are YAXB." }, { type: "text", text: "Memory: short answers.", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: "hi" },
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:x" } }] },
      ],
    };
    const out = flattenTextContent(body) as typeof body;
    expect(out.messages[0]!.content).toBe("You are YAXB.\n\nMemory: short answers.");
    expect(out.messages[1]!.content).toBe("hi");
    expect(out.messages[2]!.content).toEqual(body.messages[2]!.content);
    let sent = "";
    await plainTextContentFetch(async (_u, init) => ((sent = String(init?.body)), new Response("{}")))("https://x", { method: "POST", body: JSON.stringify(body) });
    expect(JSON.parse(sent).messages[0].content).toBe("You are YAXB.\n\nMemory: short answers.");
  });
});
