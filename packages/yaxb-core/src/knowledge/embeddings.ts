// The curated Q&A, embedded ahead of time with each EMBEDDING_MODELS entry (tools/build-embeddings.mjs):
// src/data/curated_embeddings.<model>.json. Loaded on demand, one model at a time, and only by
// surfaces that run the model (the browser), never by the Worker.
// After editing curated_qa.json run `npm run embeddings`; a test fails while a file is stale.
import type { EmbeddingModelId, EmbeddingsFile } from "./semantic.js";

const files: Record<EmbeddingModelId, () => Promise<{ default: unknown }>> = {
  minilm: () => import("../data/curated_embeddings.minilm.json", { with: { type: "json" } }),
  labse: () => import("../data/curated_embeddings.labse.json", { with: { type: "json" } }),
};

const loaded = new Map<EmbeddingModelId, Promise<EmbeddingsFile>>();

/** The curated Q&A's vectors for a model. */
export function curatedEmbeddingsFor(model: EmbeddingModelId): Promise<EmbeddingsFile> {
  let file = loaded.get(model);
  if (!file) {
    file = files[model]().then((m) => m.default as EmbeddingsFile);
    loaded.set(model, file);
  }
  return file;
}
