// Semantic search on this device: the visitor's question is embedded by the chosen
// sentence-transformer (lib/browser/offline.ts → workers/embed.worker.ts) and compared with the
// curated Q&A (embedded ahead of time, shipped with the app) and the notebook's sources (embedded
// here, once per source version and model, kept in memory for this page). Nothing leaves the
// device for it.
//
// Used two ways (Settings → Knowledge):
//   on-device answers  composeLocalAnswer from the hits (yaxb-core knowledge/semantic)
//   grounded agent     the hits' references go with the turn (client.retrieved)
import { curatedEmbeddingsFor } from "@sekaran-ind/yaxb-core/knowledge/embeddings";
import {
  EMBEDDING_MODELS,
  embeddingModelFor,
  excerptOf,
  fingerprint,
  nearest,
  sentences,
  similarity,
  type CuratedHit,
  type EmbeddingModelId,
  type NotebookHit,
} from "@sekaran-ind/yaxb-core/knowledge/semantic";
import { semanticChunks, type Notebook } from "@sekaran-ind/yaxb-core/notebook";
import type { RetrievedRef } from "@sekaran-ind/yaxb-core/schemas";
import type { AgentSettings } from "@sekaran-ind/yaxb-core/settings";
import { embedTexts } from "./offline";

/** Parts embedded per notebook at most (about 1 MB of text): keeps the first search bearable. */
const MAX_NOTEBOOK_PARTS = 2500;

type Part = { sourceId: string; title: string; part: number; text: string; vector: number[]; url?: string };
const sourceVectors = new Map<string, Part[]>();

const ready = new Set<EmbeddingModelId>();
const warming = new Map<EmbeddingModelId, Promise<void>>();

/** The model the visitor's settings, language and question call for. */
export const modelFor = (settings: Pick<AgentSettings, "knowledge" | "language">, question?: string) => embeddingModelFor(settings.knowledge?.model, settings.language, question);

/** True once the model has loaded on this device. */
export const semanticReady = (model: EmbeddingModelId) => ready.has(model);

/** Load a model in the background (the first time downloads it, then the browser caches it). */
export function warmUp(model: EmbeddingModelId): Promise<void> {
  let p = warming.get(model);
  if (!p) {
    p = Promise.all([embedTexts(model, ["warm up"]), curatedEmbeddingsFor(model)]).then(
      () => {
        ready.add(model);
      },
      (e: Error) => {
        warming.delete(model); // try again on the next question
        throw e;
      },
    );
    warming.set(model, p);
  }
  return p;
}

async function notebookParts(model: EmbeddingModelId, notebook: Notebook | null, signal?: AbortSignal): Promise<Part[]> {
  if (!notebook) return [];
  const all: Part[] = [];
  for (const s of notebook.sources) {
    const key = `${model}/${notebook.id}/${s.id}/${fingerprint(s.text)}`;
    let parts = sourceVectors.get(key);
    if (!parts) {
      const texts = semanticChunks(s.text).slice(0, Math.max(0, MAX_NOTEBOOK_PARTS - all.length));
      const vectors = await embedTexts(model, texts.map((t) => `${s.title}. ${t}`), signal);
      parts = texts.map((text, i) => ({ sourceId: s.id, title: s.title, part: i + 1, text, vector: vectors[i]!, ...(s.url ? { url: s.url } : {}) }));
      sourceVectors.set(key, parts);
    }
    all.push(...parts);
    if (all.length >= MAX_NOTEBOOK_PARTS) break;
  }
  return all;
}

export type LocalSearch = {
  model: EmbeddingModelId;
  curated: CuratedHit[];
  notebook: NotebookHit[];
  /** References for the agent (option B). */
  refs: RetrievedRef[];
};

/** Search the curated Q&A and the notebook for a question, on this device, with one model. */
export async function searchLocal(
  model: EmbeddingModelId,
  question: string,
  notebook: Notebook | null,
  { k = 4, signal }: { k?: number; signal?: AbortSignal } = {},
): Promise<LocalSearch> {
  await warmUp(model);
  const { items } = await curatedEmbeddingsFor(model);
  const [query] = await embedTexts(model, [question], signal);
  const curated = nearest(items, query!, k).map(({ id, score }) => ({ id, score }));
  const parts = nearest(await notebookParts(model, notebook, signal), query!, k);

  // For the best notebook part, the sentences that answer the question (a quote, not a paraphrase).
  const notebookHits: NotebookHit[] = [];
  for (const [i, p] of parts.entries()) {
    let excerpt = p.text;
    if (i === 0) {
      const ss = sentences(p.text);
      if (ss.length > 2) {
        const vs = await embedTexts(model, ss, signal);
        excerpt = excerptOf(
          ss,
          vs.map((v) => similarity(v, query!)),
          { margin: EMBEDDING_MODELS[model].thresholds.excerpt },
        );
      }
    }
    notebookHits.push({ sourceId: p.sourceId, part: p.part, score: p.score, title: p.title, excerpt, ...(p.url ? { url: p.url } : {}) });
  }

  // The best references go with the turn even when weak: the server tells from their scores
  // whether the knowledge base covers the question (and falls back to the web when it doesn't).
  const refs: RetrievedRef[] = [
    ...curated.map((h) => ({ ref: `curated:${h.id}`, score: h.score })),
    ...notebookHits.map((h) => ({ ref: `notebook:${h.sourceId}#${h.part}`, score: h.score })),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return { model, curated, notebook: notebookHits, refs };
}
