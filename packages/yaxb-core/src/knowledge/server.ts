// The sentence-transformer on the server side: what the agent uses when the browser's model
// isn't there, to decide whether the knowledge base covers a question (and fall back to the web),
// to re-rank web results, and to route tools. A Worker can't run a model itself, so the default is
// Cloudflare Workers AI's bge-m3 (multilingual, 1024 dimensions) over its REST API with the
// deployment's CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Any `Embed` can be passed instead
// (a local Transformers.js model in Node, a fake in tests).
import type { Env } from "../providers/index.js";
import type { WebResult } from "../web/index.js";
import { siteOf } from "../web/index.js";
import { curatedQA, type Passage } from "./index.js";
import { curatedEmbeddingText, nearest, similarity, type Embed } from "./semantic.js";

/**
 * bge-m3, calibrated on the curated Q&A (covered questions 0.72-0.89 in English, Spanish, Hindi,
 * Tamil, Telugu, Kannada, Malayalam and Bengali; unrelated ones 0.59 or less) and on tool
 * descriptions (the right tool 0.64-0.71, others below 0.6).
 */
export const SERVER_EMBEDDING = {
  id: "@cf/baai/bge-m3",
  thresholds: {
    /** The knowledge base covers a question when its best curated match reaches this. */
    covered: 0.65,
    /** Curated passages offered to the agent. */
    passage: 0.55,
    /** Web results kept after re-ranking. */
    web: 0.5,
    /** Tools routed to the agent must reach this, and be within `routeMargin` of the best. */
    route: 0.55,
    routeMargin: 0.12,
  },
} as const;

const unit = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

/** Workers AI bge-m3 over REST, or null without Cloudflare credentials. */
export function workersAiEmbedder(env: Env, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Embed | null {
  const account = typeof env.CLOUDFLARE_ACCOUNT_ID === "string" ? env.CLOUDFLARE_ACCOUNT_ID : "";
  const token = typeof env.CLOUDFLARE_API_TOKEN === "string" ? env.CLOUDFLARE_API_TOKEN : "";
  if (!/^[0-9a-f]{32}$/.test(account) || !token) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${SERVER_EMBEDDING.id}`;
  return async (texts) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 50) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: texts.slice(i, i + 50).map((t) => t.slice(0, 2000)) }),
      });
      const body = (await res.json().catch(() => null)) as { success?: boolean; result?: { data?: number[][] } } | null;
      if (!res.ok || !body?.success || !body.result?.data) throw new Error(`Workers AI embedding failed: HTTP ${res.status}`);
      out.push(...body.result.data.map(unit));
    }
    return out;
  };
}

/** Curated-Q&A search with a server embedder; the curated vectors are computed once per instance. */
export function createServerIndex(embed: Embed) {
  let vectors: Promise<{ id: string; vector: number[] }[]> | null = null;
  const load = () => {
    vectors ??= embed(curatedQA.map(curatedEmbeddingText)).then((vs) => curatedQA.map((q, i) => ({ id: q.id, vector: vs[i]! })));
    vectors.catch(() => (vectors = null));
    return vectors;
  };
  return {
    /** Curated matches for a question, best first, with their passages. */
    async search(question: string, k = 4): Promise<{ best: number; passages: Passage[] }> {
      const [items, [query]] = await Promise.all([load(), embed([question])]);
      const hits = nearest(items, query!, k);
      const byId = new Map(curatedQA.map((q) => [q.id, q]));
      return {
        best: hits[0]?.score ?? 0,
        passages: hits
          .filter((h) => h.score >= SERVER_EMBEDDING.thresholds.passage)
          .map((h) => {
            const q = byId.get(h.id)!;
            return { source: `curated:${q.id}`, content: `Q: ${q.question}\nA: ${q.answer}`, score: h.score, redFlag: q.red_flag };
          }),
      };
    },
  };
}

/**
 * Re-rank web results by meaning: the question and each result (title and snippet) are embedded,
 * and results are kept best first above the threshold. Without an embedder, the search engine's
 * own order is kept.
 */
export async function rerankWeb(question: string, results: WebResult[], embed: Embed | null, { keep = 4, minScore: min = SERVER_EMBEDDING.thresholds.web as number } = {}): Promise<(WebResult & { score: number | null })[]> {
  if (!results.length) return [];
  if (!embed) return results.slice(0, keep).map((r) => ({ ...r, score: null }));
  const [query, ...docs] = await embed([question, ...results.map((r) => `${r.title}. ${r.snippet}`)]);
  return results
    .map((r, i) => ({ ...r, score: Math.round(similarity(docs[i]!, query!) * 1000) / 1000 }))
    .filter((r) => r.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, keep);
}

/** Web results as passages the agent cites as web:<n>. Untrusted data, like every passage. */
export function webPassages(results: (WebResult & { score: number | null })[], first = 1): Passage[] {
  return results.map((r, i) => ({
    source: `web:${first + i}`,
    content: `${r.title}\nSite: ${siteOf(r.url)}\nURL: ${r.url}${r.published ? `\nPublished: ${r.published}` : ""}\n${r.snippet}`,
    score: r.score ?? 0,
    redFlag: false,
  }));
}
