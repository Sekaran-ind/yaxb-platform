/// <reference lib="webworker" />
/**
 * The kiosk's sentence-transformers (yaxb-core EMBEDDING_MODELS), in the browser: questions and
 * notebook text are embedded on this device and never sent anywhere for it.
 * Messages in:  { reqId, model: "minilm" | "labse", texts: string[] }
 * Messages out: { type: "progress", data } while a model loads, then { type: "result", reqId, vectors } or { type: "error", reqId, message }
 */
import { env, pipeline } from "@huggingface/transformers";
import { EMBEDDING_MODELS, type EmbeddingModelId } from "@sekaran-ind/yaxb-core/knowledge/semantic";

env.allowLocalModels = false;

type Extractor = (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
const extractors = new Map<EmbeddingModelId, Promise<Extractor>>();

function load(id: EmbeddingModelId) {
  let extractor = extractors.get(id);
  if (!extractor) {
    const spec = EMBEDDING_MODELS[id];
    // Cast through unknown: pipeline()'s overload union is too large for tsc to infer.
    const make = pipeline as unknown as (task: string, model: string, opts: object) => Promise<Extractor>;
    extractor = make("feature-extraction", spec.id, {
      dtype: spec.dtype,
      progress_callback: (p: unknown) => self.postMessage({ type: "progress", data: p }),
    });
    extractor.catch(() => extractors.delete(id));
    extractors.set(id, extractor);
  }
  return extractor;
}

/**
 * Named-entity recognition for slot filling: people, places and organisations, in about ten
 * languages (and names in Indian scripts, as word pieces the core merges). About 180 MB, on first use.
 */
const NER_MODEL = "Xenova/bert-base-multilingual-cased-ner-hrl";
type Tagger = (text: string) => Promise<{ entity: string; word: string; score: number }[]>;
let tagger: Promise<Tagger> | null = null;
function loadTagger() {
  const make = pipeline as unknown as (task: string, model: string, opts: object) => Promise<Tagger>;
  tagger ??= make("token-classification", NER_MODEL, { dtype: "q8", progress_callback: (p: unknown) => self.postMessage({ type: "progress", data: p }) });
  tagger.catch(() => (tagger = null));
  return tagger;
}

self.addEventListener("message", async (event: MessageEvent<{ reqId: string; task?: "embed" | "ner"; model: EmbeddingModelId; texts: string[] }>) => {
  const { reqId, task = "embed", model, texts } = event.data;
  try {
    if (task === "ner") {
      const run = await loadTagger();
      const tokens = await run((texts[0] ?? "").slice(0, 2000));
      return self.postMessage({ type: "result", reqId, vectors: tokens.map(({ entity, word, score }) => ({ entity, word, score })) });
    }
    if (!(model in EMBEDDING_MODELS)) throw new Error("Unknown model");
    const run = await load(model);
    const out = texts.length ? (await run(texts, { pooling: EMBEDDING_MODELS[model].pooling, normalize: true })).tolist() : [];
    self.postMessage({ type: "result", reqId, vectors: out });
  } catch (e) {
    self.postMessage({ type: "error", reqId, message: (e as Error).message });
  }
});
