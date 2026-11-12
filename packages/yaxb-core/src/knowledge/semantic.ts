// Semantic search with a local sentence-transformer, and answers from the knowledge base alone.
//
// The model runs where the surface can run it (the browser, in a Web Worker; Node for the build
// script), never in this module: everything here is plain math and text, safe in Workers, Node and
// the browser. The curated Q&A is embedded ahead of time (tools/build-embeddings.mjs ->
// data/curated_embeddings.json, imported from "./embeddings"), so at question time only the
// visitor's question is embedded.
//
// Two ways to use it:
//   A. composeLocalAnswer: no AI model. The closest curated answer, word for word with its source,
//      or a plain "not covered". (Settings → Knowledge → On this device only.)
//   B. The browser sends what it found as references (client.retrieved); resolveRetrieved turns
//      them back into passages from the core's own data, and search_knowledge_base offers them to
//      the agent first via config.configurable.localKnowledge.
import { AUTO_ESCALATION_REASON, looksLikeEmergency } from "../agent/safety.js";

/** The emergency check, for surfaces that can't load the agent (it's plain code). */
export { looksLikeEmergency };
import { notebookPart, type Notebook } from "../notebook/index.js";
import type { RetrievedRef } from "../schemas/index.js";
import { curatedQA, knowledgeSources, type CuratedItem, type Passage, type Retriever } from "./index.js";

/** Similarities a model's matches must reach. Each model has its own scale, so each is calibrated. */
export type Thresholds = {
  /** A curated answer is given word for word at or above this (option A). */
  answer: number;
  /** A notebook part is quoted at or above this (option A). */
  notebook: number;
  /** Passages below this are not passed to the agent (option B). */
  passage: number;
  /** A quoted excerpt keeps sentences within this of its best one. */
  excerpt: number;
};

/**
 * The sentence-transformers the kiosk can run on the device. Thresholds are calibrated on the
 * curated Q&A with paraphrased questions it covers and unrelated ones, in English and in the
 * kiosk's languages (test/fixtures/query-embeddings.json keeps real vectors to check them).
 */
export const EMBEDDING_MODELS = {
  /**
   * paraphrase-multilingual-MiniLM-L12-v2: 50 languages, small and fast. Covered questions score
   * 0.55-0.83, unrelated ones 0.28 or less. Not trained on Tamil, Telugu, Kannada, Malayalam or
   * Bengali (they score 0.22-0.40, below unrelated English), and reads only 128 tokens.
   */
  minilm: {
    id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    label: "Multilingual MiniLM",
    description: "About 120 MB. Fast, 50 languages including Hindi, Arabic, Chinese, Japanese and European languages. Not for Tamil, Telugu, Kannada, Malayalam or Bengali.",
    sizeMb: 120,
    dtype: "q8",
    dims: 384,
    pooling: "mean",
    thresholds: { answer: 0.5, notebook: 0.45, passage: 0.3, excerpt: 0.1 },
    /** Kiosk languages it was trained on (LANGUAGES codes). */
    languages: ["eng_Latn", "hin_Deva", "fra_Latn", "spa_Latn", "deu_Latn", "por_Latn", "arb_Arab", "zho_Hans", "jpn_Jpan"],
  },
  /**
   * LaBSE: 109 languages, every kiosk language, 512 tokens. Covered questions score 0.82-0.89 in
   * English and all the Indian languages, unrelated ones 0.72 or less; unrelated notebook passages 0.55-0.65.
   */
  labse: {
    id: "Xenova/LaBSE",
    label: "LaBSE",
    description: "About 470 MB. 109 languages, including Tamil, Telugu, Kannada, Malayalam and Bengali. Matches a question in one language with text in another.",
    sizeMb: 470,
    dtype: "q8",
    dims: 768,
    pooling: "cls",
    thresholds: { answer: 0.78, notebook: 0.7, passage: 0.6, excerpt: 0.04 },
    languages: ["eng_Latn", "hin_Deva", "tam_Taml", "kan_Knda", "tel_Telu", "mal_Mlym", "ben_Beng", "fra_Latn", "spa_Latn", "deu_Latn", "por_Latn", "arb_Arab", "zho_Hans", "jpn_Jpan"],
  },
} as const;
export type EmbeddingModelId = keyof typeof EMBEDDING_MODELS;
export type EmbeddingModel = (typeof EMBEDDING_MODELS)[EmbeddingModelId];
export const EMBEDDING_MODEL_IDS = Object.keys(EMBEDDING_MODELS) as EmbeddingModelId[];

/** Bengali, Tamil, Telugu, Kannada and Malayalam script: MiniLM wasn't trained on them and matches them by script alone. */
const SCRIPTS_MINILM_LACKS = /[ঀ-৿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;

/**
 * The model for a setting ("auto" or a model id), the kiosk language and, when known, the question.
 * Auto takes the small model when it knows the language. A question written in a script MiniLM
 * wasn't trained on always goes to LaBSE, whatever the setting: MiniLM's matches there are noise.
 */
export function embeddingModelFor(choice: string | undefined, language: string, question?: string): EmbeddingModelId {
  if (question && SCRIPTS_MINILM_LACKS.test(question)) return "labse";
  if (choice && choice in EMBEDDING_MODELS) return choice as EmbeddingModelId;
  return (EMBEDDING_MODELS.minilm.languages as readonly string[]).includes(language) ? "minilm" : "labse";
}

/** Turns texts into unit-length vectors (the model's pooling, normalized). */
export type Embed = (texts: string[]) => Promise<number[][]>;

/** What gets embedded for a curated item: its question (visitors' questions are compared with it). */
export const curatedEmbeddingText = (item: Pick<CuratedItem, "question">) => item.question.replace(/\s+/g, " ").trim();

/** FNV-1a: a stable fingerprint of what was embedded, so stale embeddings are caught by a test. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type EmbeddingsFile = { model: string; dims: number; items: { id: string; hash: string; vector: number[] }[] };

/** Cosine similarity of unit vectors. */
export function similarity(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/** The k entries closest to a query vector, best first. */
export function nearest<T extends { vector: readonly number[] }>(entries: readonly T[], query: readonly number[], k: number): (T & { score: number })[] {
  return entries
    .map((e) => ({ ...e, score: Math.round(similarity(e.vector, query) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---- option B: references from the browser, resolved here ------------------------------------------

const curatedById = new Map(curatedQA.map((q) => [q.id, q]));

/**
 * Passages for the references the browser's model found, from the core's own curated data and the
 * notebook sent with the turn. Unknown references and weak scores are dropped.
 */
export function resolveRetrieved(refs: readonly RetrievedRef[], notebook: Notebook | null | undefined, { minScore = EMBEDDING_MODELS.minilm.thresholds.passage as number }: { minScore?: number } = {}): Passage[] {
  const seen = new Set<string>();
  const out: Passage[] = [];
  for (const { ref, score } of [...refs].sort((a, b) => b.score - a.score)) {
    if (score < minScore || seen.has(ref)) continue;
    seen.add(ref);
    const rounded = Math.round(score * 1000) / 1000;
    if (ref.startsWith("curated:")) {
      const item = curatedById.get(ref.slice(8));
      if (item) out.push({ source: ref, content: `Q: ${item.question}\nA: ${item.answer}`, score: rounded, redFlag: item.red_flag });
    } else {
      const [id, part] = ref.slice(9).split("#");
      const found = notebookPart(notebook, id!, Number(part));
      if (found) out.push({ source: `notebook:${id}`, content: `${found.title} (part ${part})${found.url ? `\nWebsite: ${found.url}` : ""}\n${found.text}`, score: rounded, redFlag: false });
    }
  }
  return out;
}

/** A Retriever over this turn's resolved passages (they were found for the visitor's question). */
export function createPassedRetriever(passages: readonly Passage[]): Retriever {
  return { search: async (_query, k) => passages.slice(0, k) };
}

// ---- option A: answers from the knowledge base alone ------------------------------------------------

/** The knowledge source the curated Q&A belongs to (knowledge_sources.json). */
export const CURATED_SOURCE_ID = "policies";

export type Reference = { id: string; label: string };
export type CuratedHit = { id: string; score: number };
/** A notebook part, with the sentences that best match the question already picked out. */
export type NotebookHit = { sourceId: string; part: number; score: number; title: string; excerpt: string; url?: string };

export type LocalAnswer = {
  kind: "curated" | "notebook" | "web" | "none";
  /** Shown in the transcript: the answer, then "(sources: …)". */
  text: string;
  /** Read aloud and translated: the answer without the sources line. */
  body: string;
  references: Reference[];
  score: number | null;
  /** Set when the question must reach the moderators. */
  flag: { question: string; reason: string } | null;
  emergency: boolean;
};

export const LOCAL_MESSAGES = {
  emergency: "If this is an emergency, call your local emergency number now or tell the nearest staff member.",
  notCovered: "The kiosk's knowledge base and your notebook do not cover this question. A staff member can help you.",
  webIntro: "The kiosk's knowledge base doesn't cover this. These web pages may help; they are quoted as found, not checked by the kiosk's moderators:",
  redFlag: "This topic is marked for follow-up by a person. It has been passed to the moderation team.",
} as const;

// "(sources: …)" is stripped before speech by a pattern that stops at ")": keep labels free of brackets.
const plain = (s: string) => s.replace(/[()[\]]/g, "").replace(/\s+/g, " ").trim();
const sourcesLine = (refs: Reference[]) => `(sources: ${refs.map((r) => `${r.id} · ${plain(r.label)}`).join("; ")})`;

function curatedReference(item: CuratedItem): Reference {
  const src = knowledgeSources.find((s) => s.id === CURATED_SOURCE_ID);
  const parts = [src?.title ?? "Curated Q&A", `“${item.category ?? item.question.slice(0, 60)}”`];
  if (src?.moderator) parts.push(`moderated by ${src.moderator}`);
  if (src?.baseline_date) parts.push(`baseline ${src.baseline_date}`);
  return { id: `curated:${item.id}`, label: parts.join(", ") };
}

/**
 * Kiosk only (no AI model) and not covered: the best web results, quoted as the search returned
 * them, with their addresses (KNW-45). Nothing is summarised or rewritten.
 */
export function composeWebAnswer(question: string, results: readonly { title: string; url: string; snippet: string }[], { keep = 3 } = {}): LocalAnswer | null {
  if (looksLikeEmergency(question)) return null;
  const top = results.filter((r) => r.snippet.trim() && /^https?:\/\//.test(r.url)).slice(0, keep);
  if (!top.length) return null;
  const where = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/[()]/g, "").slice(0, 100);
  const references = top.map((r, i) => ({ id: `web:${i + 1}`, label: where(r.url) }));
  const quote = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > 280 ? `${t.slice(0, 277).replace(/\s+\S*$/, "")}…` : t;
  };
  const body = [LOCAL_MESSAGES.webIntro, ...top.map((r) => `- **${plain(r.title) || where(r.url)}**: “${quote(r.snippet)}”`)].join("\n");
  return { kind: "web", body, text: `${body}\n\n${sourcesLine(references)}`, references, score: null, flag: null, emergency: false };
}

/**
 * The kiosk's answer without an AI model: the best curated answer (verbatim) or notebook excerpt
 * (quoted) above its threshold, with its reference; otherwise a plain "not covered" that is
 * escalated. Possible emergencies are escalated and get the emergency line first, as in the agent.
 * Nothing is paraphrased, so nothing is added that the source doesn't say.
 */
export function composeLocalAnswer(
  question: string,
  { curated, notebook = [] }: { curated: readonly CuratedHit[]; notebook?: readonly NotebookHit[] },
  { threshold = EMBEDDING_MODELS.minilm.thresholds.answer as number, notebookThreshold = EMBEDDING_MODELS.minilm.thresholds.notebook as number }: { threshold?: number; notebookThreshold?: number } = {},
): LocalAnswer {
  const emergency = looksLikeEmergency(question);
  const bestCurated = [...curated].sort((a, b) => b.score - a.score).find((h) => h.score >= threshold && curatedById.has(h.id));
  const bestNotebook = [...notebook].sort((a, b) => b.score - a.score).find((h) => h.score >= notebookThreshold && h.excerpt.trim());
  const lead = emergency ? [LOCAL_MESSAGES.emergency] : [];
  const emergencyFlag = emergency ? { question, reason: AUTO_ESCALATION_REASON } : null;

  const useNotebook = bestNotebook && (!bestCurated || bestNotebook.score > bestCurated.score);
  if (useNotebook) {
    const site = bestNotebook.url ? `, ${bestNotebook.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 100)}` : "";
    const references = [{ id: `notebook:${bestNotebook.sourceId}`, label: `${bestNotebook.title}, part ${bestNotebook.part}${site}` }];
    const body = [...lead, `Your notebook source “${plain(bestNotebook.title)}” says: “${bestNotebook.excerpt.trim()}”`].join("\n\n");
    return { kind: "notebook", body, text: `${body}\n\n${sourcesLine(references)}`, references, score: bestNotebook.score, flag: emergencyFlag, emergency };
  }
  if (bestCurated) {
    const item = curatedById.get(bestCurated.id)!;
    const references = [curatedReference(item)];
    const body = [...lead, item.answer.trim(), ...(item.red_flag ? [LOCAL_MESSAGES.redFlag] : [])].join("\n\n");
    const flag = emergencyFlag ?? (item.red_flag ? { question, reason: `Red-flag topic (curated:${item.id}), answered on the device` } : null);
    return { kind: "curated", body, text: `${body}\n\n${sourcesLine(references)}`, references, score: bestCurated.score, flag, emergency };
  }
  const body = [...lead, LOCAL_MESSAGES.notCovered].join("\n\n");
  return {
    kind: "none",
    body,
    text: body,
    references: [],
    score: null,
    // Not covered is not a reason for a moderator: only red flags and possible emergencies are.
    flag: emergencyFlag,
    emergency,
  };
}

/** Sentences of a passage, for picking the excerpt that answers a question. */
export function sentences(text: string): string[] {
  return (text.replace(/\s+/g, " ").match(/[^.!?。！？]+[.!?。！？]*/g) ?? []).map((s) => s.trim()).filter((s) => s.length > 2);
}

/** The best sentence, plus up to `max - 1` more that score within `margin` of it, in their original order. */
export function excerptOf(parts: readonly string[], scores: readonly number[], { max = 2, margin = 0.1 } = {}): string {
  const ranked = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  const best = ranked[0]?.[0] ?? 0;
  const keep = new Set(
    ranked
      .filter(([s]) => s >= best - margin)
      .slice(0, max)
      .map(([, i]) => i),
  );
  return parts.filter((_, i) => keep.has(i)).join(" ");
}
