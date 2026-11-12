/// <reference lib="webworker" />
/**
 * In-browser translation (NLLB-200) so translated text never leaves the device.
 * Messages in:  { text, src_lang, tgt_lang }
 * Messages out: progress events from model loading, { status: "update", output }, { status: "complete", output }
 */
import { env, pipeline, TextStreamer, type TranslationPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

let translator: Promise<TranslationPipeline> | null = null;

function getTranslator() {
  // Cast through unknown: pipeline()'s overload union is too large for tsc to infer.
  const load = pipeline as unknown as (task: string, model: string, opts: object) => Promise<TranslationPipeline>;
  translator ??= load("translation", "Xenova/nllb-200-distilled-600M", {
    progress_callback: (p: unknown) => self.postMessage(p),
  });
  return translator;
}

self.addEventListener("message", async (event: MessageEvent<{ text: string; src_lang: string; tgt_lang: string; reqId?: string }>) => {
  const reqId = event.data.reqId;
  try {
    const t = await getTranslator();
    self.postMessage({ status: "ready", reqId });
    let partial = "";
    const streamer = new TextStreamer(t.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        partial += text;
        self.postMessage({ status: "update", reqId, output: partial });
      },
    });
    const output = await t(event.data.text.slice(0, 2000), {
      src_lang: event.data.src_lang,
      tgt_lang: event.data.tgt_lang,
      streamer,
    } as never);
    const text = Array.isArray(output) ? (output[0] as { translation_text: string }).translation_text : "";
    self.postMessage({ status: "complete", reqId, output: text });
  } catch (e) {
    self.postMessage({ status: "error", reqId, message: (e as Error).message });
  }
});
