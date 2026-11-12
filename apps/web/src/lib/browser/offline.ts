import { mergeEntities, type Entity } from "@sekaran-ind/yaxb-core/journeys";
import type { EmbeddingModelId } from "@sekaran-ind/yaxb-core/knowledge/semantic";

// The kiosk's offline models (Transformers.js, in Web Workers), as plain async functions so
// journeys can chain them: summarise → assistant → translate. Text never leaves the device.
// The models are the Sandbox's allowlisted ones (lib/sandbox-models.ts) and the NLLB translator.
// First use downloads the model (hundreds of MB), then the browser caches it.

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onPartial?: (text: string) => void };
export type OfflineProgress = { worker: "sandbox" | "translate" | "embed"; file?: string; progress?: number; status: string };

const listeners = new Set<(p: OfflineProgress) => void>();
/** Model download / load progress, for a status line. Returns an unsubscribe function. */
export function onOfflineProgress(listener: (p: OfflineProgress) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const emit = (p: OfflineProgress) => listeners.forEach((l) => l(p));

let sandbox: Worker | null = null;
let translator: Worker | null = null;
let embedder: Worker | null = null;
const pending = new Map<string, Pending>();
const reqId = () => crypto.randomUUID();

function sandboxWorker() {
  if (!sandbox) {
    sandbox = new Worker(new URL("../../workers/sandbox.worker.ts", import.meta.url), { type: "module" });
    sandbox.onmessage = (e: MessageEvent) => {
      const d = e.data as { type: string; reqId?: string; data?: unknown; message?: string };
      if (d.type === "progress") return emit({ worker: "sandbox", ...(d.data as object), status: String((d.data as { status?: string })?.status ?? "progress") });
      const p = d.reqId ? pending.get(d.reqId) : undefined;
      if (!p) return;
      pending.delete(d.reqId!);
      if (d.type === "result") p.resolve(d.data);
      else p.reject(new Error(d.message ?? "The on-device model failed."));
    };
  }
  return sandbox;
}

function translateWorker() {
  if (!translator) {
    translator = new Worker(new URL("../../workers/translate.worker.ts", import.meta.url), { type: "module" });
    translator.onmessage = (e: MessageEvent) => {
      const d = e.data as { status: string; reqId?: string; output?: string; message?: string; file?: string; progress?: number };
      if (!d.reqId) return emit({ worker: "translate", file: d.file, progress: d.progress, status: d.status });
      const p = pending.get(d.reqId);
      if (!p) return;
      if (d.status === "update") p.onPartial?.(d.output ?? "");
      else if (d.status === "complete") {
        pending.delete(d.reqId);
        p.resolve(d.output ?? "");
      } else if (d.status === "error") {
        pending.delete(d.reqId);
        p.reject(new Error(d.message ?? "On-device translation failed."));
      }
    };
  }
  return translator;
}

function embedWorker() {
  if (!embedder) {
    embedder = new Worker(new URL("../../workers/embed.worker.ts", import.meta.url), { type: "module" });
    embedder.onmessage = (e: MessageEvent) => {
      const d = e.data as { type: string; reqId?: string; data?: unknown; vectors?: number[][]; message?: string };
      if (d.type === "progress") return emit({ worker: "embed", ...(d.data as object), status: String((d.data as { status?: string })?.status ?? "progress") });
      const p = d.reqId ? pending.get(d.reqId) : undefined;
      if (!p) return;
      pending.delete(d.reqId!);
      if (d.type === "result") p.resolve(d.vectors ?? []);
      else p.reject(new Error(d.message ?? "The on-device search model failed."));
    };
  }
  return embedder;
}

/** Embed texts on the device with one of the kiosk's sentence-transformers, in batches. */
export async function embedTexts(model: EmbeddingModelId, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    out.push(...((await call(embedWorker(), { model, texts: texts.slice(i, i + 32) }, undefined, signal)) as number[][]));
  }
  return out;
}

/** People, places and organisations in a text, found on the device (for slot filling). */
export async function recognizeEntities(text: string, signal?: AbortSignal): Promise<Entity[]> {
  const tokens = (await call(embedWorker(), { task: "ner", texts: [text] }, undefined, signal)) as { entity: string; word: string; score: number }[];
  return mergeEntities(tokens);
}

function call(worker: Worker, message: object, onPartial?: (t: string) => void, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = reqId();
    pending.set(id, { resolve, reject, onPartial });
    signal?.addEventListener("abort", () => {
      pending.delete(id);
      reject(new DOMException("Stopped", "AbortError"));
    });
    worker.postMessage({ ...message, reqId: id });
  });
}

const runSandbox = (id: string, req: { text: string; question?: string; labels?: string }, signal?: AbortSignal) =>
  call(sandboxWorker(), { id, ...req }, undefined, signal);

/** Pieces of about `size` characters, cut at sentence ends. */
function pieces(text: string, size: number, max: number): string[] {
  const out: string[] = [];
  let rest = text.replace(/\s+/g, " ").trim();
  while (rest && out.length < max) {
    if (rest.length <= size) {
      out.push(rest);
      break;
    }
    const cut = rest.lastIndexOf(". ", size);
    const end = cut > size * 0.5 ? cut + 1 : size;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  return out;
}

/** Summarise on the device (distilbart). Long text is summarised in parts, then the parts together. */
export async function summarize(text: string, signal?: AbortSignal): Promise<string> {
  const parts = pieces(text, 2500, 6);
  if (!parts.length) throw new Error("There's no text to summarise.");
  const summaries: string[] = [];
  for (const part of parts) {
    const out = (await runSandbox("summarization", { text: part }, signal)) as { summary_text?: string }[];
    summaries.push(out?.[0]?.summary_text?.trim() ?? "");
  }
  const joined = summaries.filter(Boolean).join(" ");
  if (parts.length === 1 || joined.length < 1200) return joined;
  const out = (await runSandbox("summarization", { text: joined }, signal)) as { summary_text?: string }[];
  return out?.[0]?.summary_text?.trim() ?? joined;
}

/** Find the passage that answers a question (extractive QA), across the document's parts. */
export async function answer(question: string, context: string, signal?: AbortSignal): Promise<{ text: string; score: number }> {
  let best = { text: "", score: -1 };
  for (const part of pieces(context, 1500, 12)) {
    const out = (await runSandbox("question-answering", { text: part, question }, signal)) as { answer?: string; score?: number };
    if ((out?.score ?? 0) > best.score && out?.answer) {
      const at = part.indexOf(out.answer);
      const start = Math.max(0, part.lastIndexOf(". ", at) + 1);
      const end = part.indexOf(". ", at + out.answer.length);
      best = { text: `${out.answer}\n\n“${part.slice(start, end === -1 ? undefined : end + 1).trim()}”`, score: out.score ?? 0 };
    }
  }
  if (best.score < 0) throw new Error("The on-device model couldn't find an answer in that source.");
  return best;
}

/** Sentiment on the device. */
export async function classify(text: string, signal?: AbortSignal) {
  const out = (await runSandbox("text-classification", { text: text.slice(0, 2000) }, signal)) as { label: string; score: number }[];
  return { label: out?.[0]?.label ?? "", score: out?.[0]?.score ?? 0, text: out?.[0]?.label ?? "" };
}

/** Translate on the device (NLLB-200), part by part. */
export async function translate(text: string, tgt: string, { src = "eng_Latn", onPartial, signal }: { src?: string; onPartial?: (t: string) => void; signal?: AbortSignal } = {}) {
  if (tgt === src) return text;
  const done: string[] = [];
  for (const part of pieces(text, 1500, 20)) {
    const out = (await call(translateWorker(), { text: part, src_lang: src, tgt_lang: tgt }, (t) => onPartial?.([...done, t].join(" ")), signal)) as string;
    done.push(out);
  }
  return done.join(" ");
}
