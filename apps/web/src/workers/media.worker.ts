/// <reference lib="webworker" />
/**
 * Reading photos on the device (MED-5): Florence-2 (MIT) through Transformers.js, for the text in a
 * photo (OCR) or a description of it (a caption). The photo never leaves the device for this. The
 * model is fetched once from the Hugging Face Hub and kept by the browser.
 */
import { AutoProcessor, AutoTokenizer, env, Florence2ForConditionalGeneration, pipeline, RawImage } from "@huggingface/transformers";

env.allowLocalModels = false;
const MODEL = "onnx-community/Florence-2-base-ft";
const TASKS = { ocr: "<OCR>", caption: "<MORE_DETAILED_CAPTION>" } as const;

type Loaded = { model: Florence2ForConditionalGeneration; processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>; tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> };
let loading: Promise<Loaded> | null = null;
function load(): Promise<Loaded> {
  loading ??= (async () => {
    const progress_callback = (p: unknown) => self.postMessage({ type: "progress", data: p });
    const [model, processor, tokenizer] = await Promise.all([
      Florence2ForConditionalGeneration.from_pretrained(MODEL, { dtype: "q8", progress_callback }) as Promise<Florence2ForConditionalGeneration>,
      AutoProcessor.from_pretrained(MODEL, { progress_callback }),
      AutoTokenizer.from_pretrained(MODEL, { progress_callback }),
    ]);
    return { model, processor, tokenizer };
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

// Voice notes (MED-9): Whisper (MIT), multilingual, on 16 kHz mono samples decoded by the page.
const WHISPER = "onnx-community/whisper-base";
type Transcriber = (audio: Float32Array, o: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let hearing: Promise<Transcriber> | null = null;
const transcriber = () =>
  (hearing ??= (pipeline("automatic-speech-recognition", WHISPER, { dtype: "q8", progress_callback: (p: unknown) => self.postMessage({ type: "progress", data: p }) }) as unknown as Promise<Transcriber>).catch((e) => {
    hearing = null;
    throw e;
  }));

self.addEventListener("message", async (event: MessageEvent<{ reqId: string; blob: Blob; mode: "ocr" | "caption" | "transcribe"; samples?: Float32Array }>) => {
  const { reqId, blob, mode } = event.data;
  if (mode === "transcribe") {
    try {
      const out = await (await transcriber())(event.data.samples!, { chunk_length_s: 30, stride_length_s: 5, task: "transcribe" });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).replace(/\s+/g, " ").trim();
      self.postMessage({ type: "result", reqId, text });
    } catch (e) {
      self.postMessage({ type: "error", reqId, message: (e as Error).message });
    }
    return;
  }
  try {
    const { model, processor, tokenizer } = await load();
    const task = TASKS[mode];
    const image = await RawImage.fromBlob(blob);
    const p = processor as unknown as { construct_prompts(t: string): string; (img: RawImage): Promise<Record<string, unknown>>; post_process_generation(text: string, task: string, size: [number, number]): Record<string, unknown> };
    const textInputs = (tokenizer as unknown as (t: string) => Record<string, unknown>)(p.construct_prompts(task));
    const visionInputs = await p(image);
    const ids = await (model as unknown as { generate(x: Record<string, unknown>): Promise<unknown> }).generate({ ...textInputs, ...visionInputs, max_new_tokens: 256 });
    const raw = (tokenizer as unknown as { batch_decode(ids: unknown, o: { skip_special_tokens: boolean }): string[] }).batch_decode(ids, { skip_special_tokens: false })[0] ?? "";
    const out = p.post_process_generation(raw, task, image.size as [number, number]);
    const text = String(out[task] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    self.postMessage({ type: "result", reqId, text });
  } catch (e) {
    self.postMessage({ type: "error", reqId, message: (e as Error).message });
  }
});
