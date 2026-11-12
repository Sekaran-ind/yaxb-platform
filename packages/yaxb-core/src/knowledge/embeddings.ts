// The curated Q&A, embedded ahead of time with each EMBEDDING_MODELS entry (tools/build-embeddings.mjs):
// src/data/curated_embeddings.<model>.ts, vectors as base64 Float32. Loaded on demand, one model at a
// time, and only by surfaces that run the model (the browser), never by the Worker.
// After editing curated_qa.json run `npm run embeddings`; a test fails while a file is stale.
import type { EmbeddingModelId, EmbeddingsFile } from "./semantic.js";

type Packed = { model: string; dims: number; items: { id: string; hash: string; vector: string }[] };

const files: Record<EmbeddingModelId, () => Promise<{ default: Packed }>> = {
  minilm: () => import("../data/curated_embeddings.minilm.js"),
  labse: () => import("../data/curated_embeddings.labse.js"),
};

/** base64 of little-endian Float32 values -> numbers. */
function unpack(b64: string): number[] {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
}

const loaded = new Map<EmbeddingModelId, Promise<EmbeddingsFile>>();

/** The curated Q&A's vectors for a model. */
export function curatedEmbeddingsFor(model: EmbeddingModelId): Promise<EmbeddingsFile> {
  let file = loaded.get(model);
  if (!file) {
    file = files[model]().then(({ default: f }) => ({ model: f.model, dims: f.dims, items: f.items.map((i) => ({ id: i.id, hash: i.hash, vector: unpack(i.vector) })) }));
    // A failed load (offline, or a dev rebuild mid-fetch) is not kept: the next question tries again.
    file.catch(() => loaded.delete(model));
    loaded.set(model, file);
  }
  return file;
}
