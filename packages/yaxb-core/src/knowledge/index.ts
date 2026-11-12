// What the kiosk can answer from: the moderated Q&A set (always available, bundled) and,
// optionally, a vector index that the surface plugs in (Cloudflare Vectorize on the web).
import curatedJson from "../data/curated_qa.json" with { type: "json" };
import sourcesJson from "../data/knowledge_sources.json" with { type: "json" };

export type KnowledgeSource = {
  id: string;
  title: string;
  description: string;
  baseline_date: string | null;
  moderator: string;
  curator: string;
};
export type CuratedItem = { id: string; question: string; answer: string; category: string | null; red_flag: boolean };
export type Passage = { source: string; content: string; score: number; redFlag: boolean };

/** Anything that returns passages for a query. */
export interface Retriever {
  search(query: string, k: number): Promise<Passage[]>;
}

export const knowledgeSources: readonly KnowledgeSource[] = sourcesJson as KnowledgeSource[];
export const curatedQA: readonly CuratedItem[] = curatedJson as CuratedItem[];

const STOP = new Set(
  ("a an and are as at be but by can do does for from how i if in is it me my of on or should so that the " +
    "this to was what when where which who why will with you your").split(" "),
);

function tokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w)));
}

/** Keyword-overlap search over the curated Q&A: share of the query's words found in the question and category. */
export function createCuratedRetriever(items: readonly CuratedItem[] = curatedQA): Retriever {
  const indexed = items.map((item) => ({ item, words: tokens(`${item.question} ${item.category ?? ""}`) }));
  return {
    async search(query, k) {
      const q = tokens(query);
      if (!q.size) return [];
      return indexed
        .map(({ item, words }) => {
          let overlap = 0;
          for (const w of q) if (words.has(w)) overlap++;
          return { item, score: overlap / q.size };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ item, score }) => ({
          source: `curated:${item.id}`,
          content: `Q: ${item.question}\nA: ${item.answer}`,
          score: Math.round(score * 1000) / 1000,
          redFlag: item.red_flag,
        }));
    },
  };
}

// The subset of Cloudflare's Vectorize and Workers AI bindings used here.
export interface VectorIndexLike {
  query(
    vector: number[],
    options: { topK: number; returnMetadata?: "all" | "indexed" | "none" },
  ): Promise<{ matches: { id: string; score: number; metadata?: Record<string, unknown> }[] }>;
}
export interface EmbedderLike {
  run(model: string, input: { text: string[] }): Promise<unknown>;
}

/**
 * A Vectorize index whose vectors carry `{ text, source }` metadata, embedded with a Workers AI
 * model. Ingest with the same model you query with.
 */
export function createVectorizeRetriever({
  index,
  ai,
  model = "@cf/baai/bge-base-en-v1.5",
  minScore = 0.5,
}: {
  index: VectorIndexLike;
  ai: EmbedderLike;
  model?: string;
  minScore?: number;
}): Retriever {
  return {
    async search(query, k) {
      const out = (await ai.run(model, { text: [query] })) as { data?: number[][] };
      const vector = out.data?.[0];
      if (!vector) return [];
      const { matches } = await index.query(vector, { topK: k, returnMetadata: "all" });
      return matches
        .filter((m) => m.score >= minScore && typeof m.metadata?.text === "string")
        .map((m) => ({
          source: String(m.metadata?.source ?? `vector:${m.id}`),
          content: String(m.metadata?.text),
          score: Math.round(m.score * 1000) / 1000,
          redFlag: m.metadata?.red_flag === true,
        }));
    },
  };
}

/** Vector passages first (when configured and working), then curated answers. */
export function createKnowledgeService({
  vector,
  curated = createCuratedRetriever(),
  onError,
}: { vector?: Retriever; curated?: Retriever; onError?: (e: unknown) => void } = {}): Retriever & { vectorEnabled: boolean } {
  return {
    vectorEnabled: Boolean(vector),
    async search(query, k) {
      const passages: Passage[] = [];
      if (vector) {
        try {
          passages.push(...(await vector.search(query, k)));
        } catch (e) {
          onError?.(e);
        }
      }
      passages.push(...(await curated.search(query, k)));
      return passages;
    },
  };
}
