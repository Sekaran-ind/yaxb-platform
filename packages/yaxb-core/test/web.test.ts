// Web fallback, re-ranking and semantic tool routing, with a fake sentence-transformer (shared
// words make similar vectors) and a fake search service. Nothing calls the network.
import { describe, expect, it } from "vitest";
import { createKiosk, webSourcesLine } from "../src/agent/index.js";
import { routeTools } from "../src/agent/routing.js";
import type { AgentEvent } from "../src/events/index.js";
import { curatedQA } from "../src/knowledge/index.js";
import { composeWebAnswer, type Embed } from "../src/knowledge/semantic.js";
import { rerankWeb } from "../src/knowledge/server.js";
import { DEFAULT_AGENT_SETTINGS, capabilities } from "../src/settings/index.js";
import { createMemoryModerationStore, createMemoryThreadStore } from "../src/stores/index.js";
import { createBraveSearch, parseDomains, webSearchFromEnv, type WebResult, type WebSearch } from "../src/web/index.js";
import { ScriptedModel, type Step } from "./scripted-model.js";

const THREAD = "web:0f8fad5b-d9cb-469f-a165-70867728950e";
const SELECTION = { provider: "anthropic", model: "claude-sonnet-5-5", temperature: 0.3 };

const STOP = new Set("a an and are as at be can do does for from how i if in is it me my of on or the to what when with you your".split(" "));
/** Bag of words hashed into 256 buckets, normalized: texts sharing words are similar. */
const fakeEmbed: Embed = async (texts) =>
  texts.map((t) => {
    const v = new Array<number>(256).fill(0);
    for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (STOP.has(w)) continue;
      let h = 0;
      for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 256;
      v[h]! += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });

const RESULTS: WebResult[] = [
  { title: "Holiday pay rules", url: "https://labour.example.gov/holiday-pay", snippet: "Workers on a public holiday are paid twice the daily wage for holiday work." },
  { title: "Cat pictures", url: "https://cats.example.com", snippet: "Cute cats and kittens." },
];
function fakeSearch(results = RESULTS) {
  const queries: string[] = [];
  const search: WebSearch = {
    provider: "tavily",
    domains: [],
    async search(q) {
      queries.push(q);
      return results;
    },
  };
  return { search, queries };
}

async function collect(stream: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

function setup(steps: Step[], { web = fakeSearch().search as WebSearch | null, embed = fakeEmbed as Embed | null } = {}) {
  const model = new ScriptedModel(steps);
  const kiosk = createKiosk({
    env: { ANTHROPIC_API_KEY: "k" },
    threads: createMemoryThreadStore(),
    moderation: createMemoryModerationStore(),
    modelFactory: async () => model,
    webSearch: web,
    embed,
  });
  return { kiosk, model };
}
const systemOf = (m: ScriptedModel) => JSON.stringify(m.calls[0]!.find((x) => x.getType() === "system")?.content);
const lean = { ...DEFAULT_AGENT_SETTINGS, harness: "lean" as const };

describe("web search services", () => {
  it("come from the deployment's keys, Tavily first, with an optional domain allowlist", async () => {
    expect(webSearchFromEnv({})).toBeNull();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ results: [{ title: "T", url: "https://who.int/a", content: "Snippet" }] }));
    }) as unknown as typeof fetch;
    const w = webSearchFromEnv({ TAVILY_API_KEY: "tv", BRAVE_SEARCH_API_KEY: "br", WEB_SEARCH_DOMAINS: "who.int, https://www.nhs.uk/x, not a domain" }, fetchImpl)!;
    expect(w.provider).toBe("tavily");
    expect(w.domains).toEqual(["who.int", "www.nhs.uk"]);
    expect(await w.search("dengue")).toEqual([{ title: "T", url: "https://who.int/a", snippet: "Snippet" }]);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ query: "dengue", include_domains: ["who.int", "www.nhs.uk"] });
    expect(parseDomains("")).toEqual([]);
  });

  it("Brave: restricted by site:, HTML stripped, duplicates and non-web links dropped", async () => {
    let asked = "";
    const fetchImpl = (async (url: string) => {
      asked = decodeURIComponent(url);
      return new Response(
        JSON.stringify({
          web: {
            results: [
              { title: "<strong>Dengue</strong> facts", url: "https://who.int/d", description: "Dengue is a <strong>viral</strong> infection &amp; spreads by mosquitoes." },
              { title: "Again", url: "https://who.int/d", description: "dup" },
              { title: "Bad", url: "javascript:alert(1)", description: "x" },
            ],
          },
        }),
      );
    }) as unknown as typeof fetch;
    const out = await createBraveSearch({ apiKey: "k", domains: ["who.int"], fetch: fetchImpl }).search("dengue");
    expect(asked).toContain("(site:who.int)");
    expect(out).toEqual([{ title: "Dengue facts", url: "https://who.int/d", snippet: "Dengue is a viral infection & spreads by mosquitoes." }]);
  });

  it("capabilities say which service is configured, without the key", () => {
    expect(capabilities({}).web).toBeNull();
    expect(capabilities({ BRAVE_SEARCH_API_KEY: "secret" }).web).toEqual({ provider: "brave", domains: [] });
  });
});

describe("re-ranking", () => {
  it("keeps the results that mean the same as the question, best first", async () => {
    const ranked = await rerankWeb("holiday pay for public holiday work", RESULTS, fakeEmbed, { minScore: 0.2 });
    expect(ranked.map((r) => r.url)).toEqual(["https://labour.example.gov/holiday-pay"]);
    expect(ranked[0]!.score).toBeGreaterThan(0.2);
  });

  it("keeps the engine's order without a model", async () => {
    expect((await rerankWeb("x", RESULTS, null)).map((r) => r.score)).toEqual([null, null]);
  });
});

describe("semantic tool routing", () => {
  const tools = [
    { name: "weather_now", description: "Current weather forecast for a city" },
    { name: "pharmacy_hours", description: "Pharmacy opening hours and locations" },
    { name: "appointment_book", description: "Book change or cancel a clinic appointment" },
    { name: "lab_results", description: "Laboratory test results" },
    { name: "bed_availability", description: "Hospital bed availability by ward" },
  ];

  it("offers only the tools that match the message", async () => {
    const { tools: picked } = await routeTools("When are pharmacy opening hours on Sunday?", tools, fakeEmbed, { minScore: 0.2 });
    expect(picked.map((t) => t.name)).toEqual(["pharmacy_hours"]);
  });

  it("offers nothing extra for small talk, and everything when there are only a few tools", async () => {
    expect((await routeTools("hello there", tools, fakeEmbed, { minScore: 0.2 })).tools).toEqual([]);
    expect((await routeTools("hello there", tools.slice(0, 3), fakeEmbed)).tools).toHaveLength(3);
  });

  it("embeds each tool description once", async () => {
    let embedded = 0;
    const counting: Embed = async (t) => ((embedded += t.length), fakeEmbed(t));
    const cache = new Map<string, number[]>();
    await routeTools("pharmacy", tools, counting, { cache });
    await routeTools("weather", tools, counting, { cache });
    expect(embedded).toBe(tools.length + 2);
  });
});

describe("web fallback", () => {
  it("searches the web automatically when the knowledge base doesn't cover the question, and offers the results as cited web sources", async () => {
    const { search, queries } = fakeSearch();
    const { kiosk, model } = setup([{ calls: [{ name: "search_knowledge_base", args: { query: "holiday pay" } }] }, { text: "According to labour.example.gov ... (sources: web:1)" }], { web: search });
    const events = await collect(kiosk.ask({ threadId: THREAD, message: "How much holiday pay for public holiday work?", selection: SELECTION, settings: lean }));
    expect(queries).toEqual(["How much holiday pay for public holiday work?"]);
    expect(events.slice(0, 2)).toEqual([
      { type: "tool_start", id: "auto-web-search", name: "web_search", subagent: null, nested: false },
      { type: "tool_end", id: "auto-web-search", name: "web_search", nested: false },
    ]);
    expect(systemOf(model)).toContain("searched the web");
    expect(model.boundTools[0]).toContain("web_search");
    const reply = String(model.calls[1]!.find((m) => m.getType() === "tool")?.content);
    expect(reply).toContain("source=web:1");
    expect(reply).toContain("URL: https://labour.example.gov/holiday-pay");
    expect(reply).not.toContain("cats.example.com"); // re-ranked away
    // The kiosk names the cited site itself, whatever the model wrote.
    const text = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("");
    expect(text.endsWith("\n\n(sources: web:1 · labour.example.gov/holiday-pay)")).toBe(true);
  });

  it("lists only the web ids an answer cites, without brackets that would end the line early", () => {
    const urls = { "web:1": "https://en.wikipedia.org/wiki/Delhi_(city)", "web:2": "https://who.int/x" };
    expect(webSourcesLine("New Delhi (sources: web:1)", urls)).toBe("\n\n(sources: web:1 · en.wikipedia.org/wiki/Delhi_%28city%29)");
    expect(webSourcesLine("No web here (sources: curated:qa-001)", urls)).toBe("");
  });

  it("doesn't search or offer the web when the knowledge base covers the question", async () => {
    const { search, queries } = fakeSearch();
    const { kiosk, model } = setup([{ text: "ok" }], { web: search });
    await collect(kiosk.ask({ threadId: THREAD, message: curatedQA.find((q) => q.id === "qa-020")!.question, selection: SELECTION, settings: lean }));
    expect(queries).toEqual([]);
    expect(model.boundTools[0]).not.toContain("web_search");
    expect(systemOf(model)).not.toContain("web");
  });

  it("trusts the browser's strong match without asking the server", async () => {
    let serverCalls = 0;
    const { search, queries } = fakeSearch();
    const { kiosk } = setup([{ text: "ok" }], { web: search, embed: async (t) => ((serverCalls += 1), fakeEmbed(t)) });
    await collect(kiosk.ask({ threadId: THREAD, message: "Can I keep a vendor's present?", selection: SELECTION, settings: lean, client: { thread: null, notebook: null, retrieved: [{ ref: "curated:qa-020", score: 0.83 }] } }));
    expect(serverCalls).toBe(0);
    expect(queries).toEqual([]);
  });

  it("never sends a possible emergency to the web, and respects Settings → web off", async () => {
    for (const [message, settings] of [
      ["I have chest pain and holiday pay questions", lean],
      ["How much holiday pay for public holiday work?", { ...lean, knowledge: { ...lean.knowledge, web: "off" as const } }],
    ] as const) {
      const { search, queries } = fakeSearch();
      const { kiosk, model } = setup([{ text: "ok" }], { web: search });
      await collect(kiosk.ask({ threadId: THREAD, message, selection: SELECTION, settings }));
      expect(queries).toEqual([]);
      expect(model.boundTools[0]).not.toContain("web_search");
    }
  });

  it("offers web_search as a tool when coverage is unknown (no sentence-transformer anywhere)", async () => {
    const { search, queries } = fakeSearch();
    const { kiosk, model } = setup(
      [{ calls: [{ name: "web_search", args: { query: "holiday pay" } }] }, { text: "According to ... (sources: web:1)" }],
      { web: search, embed: null },
    );
    await collect(kiosk.ask({ threadId: THREAD, message: "How much holiday pay?", selection: SELECTION, settings: lean }));
    expect(systemOf(model)).toContain("you may call `web_search`");
    expect(queries).toEqual(["holiday pay"]);
    expect(String(model.calls[1]!.find((m) => m.getType() === "tool")?.content)).toContain("[web:1]");
  });
});

describe("kiosk only (no AI model): web results quoted as found (KNW-45)", () => {
  it("quotes the top results with their addresses, and nothing for an emergency", async () => {
    const { kiosk, model } = setup([]);
    const results = await kiosk.searchWeb("How much holiday pay for public holiday work?");
    expect(results.map((r) => r.url)).toEqual(["https://labour.example.gov/holiday-pay"]);
    expect(model.calls).toHaveLength(0);
    const a = composeWebAnswer("What is the capital of India?", [
      { title: "India (Britannica)", url: "https://www.britannica.com/place/India", snippet: "New Delhi is the capital of India." },
      { title: "", url: "https://example.org/a", snippet: "   " },
    ])!;
    expect(a.kind).toBe("web");
    expect(a.body).toContain("“New Delhi is the capital of India.”");
    expect(a.text).toContain("(sources: web:1 · britannica.com/place/India)");
    expect(a.references).toHaveLength(1);
    expect(composeWebAnswer("I have crushing chest pain right now", [{ title: "x", url: "https://x.org", snippet: "y" }])).toBeNull();
    expect(await kiosk.searchWeb("I have crushing chest pain right now")).toEqual([]);
    expect(await setup([], { web: null }).kiosk.searchWeb("anything")).toEqual([]);
  });
});
