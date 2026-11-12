/// <reference lib="webworker" />
/**
 * Sandbox: runs small Transformers.js models in the browser.
 * One cached pipeline per model id. Only models from the allowlist in
 * src/lib/sandbox-models.ts are accepted.
 */
import { env, pipeline } from "@huggingface/transformers";
import { SANDBOX_MODELS, type SandboxRequest } from "@/lib/sandbox-models";

env.allowLocalModels = false;

type AnyPipeline = (...args: unknown[]) => Promise<unknown>;
const cache = new Map<string, Promise<AnyPipeline>>();

function load(task: string, model: string) {
  if (!cache.has(model)) {
    cache.set(
      model,
      pipeline(task as never, model, {
        progress_callback: (p: unknown) => self.postMessage({ type: "progress", data: p }),
      }) as unknown as Promise<AnyPipeline>,
    );
  }
  return cache.get(model)!;
}

self.addEventListener("message", async (event: MessageEvent<SandboxRequest & { reqId?: string }>) => {
  const req = event.data;
  const reqId = req.reqId;
  const spec = SANDBOX_MODELS.find((m) => m.id === req.id);
  if (!spec) return self.postMessage({ type: "error", reqId, message: "Unknown model" });
  try {
    const run = await load(spec.pipelineTask, spec.model);
    let result: unknown;
    switch (spec.input) {
      case "qa":
        result = await run(req.question ?? "", req.text, spec.params);
        break;
      case "zero-shot":
        result = await run(
          req.text,
          (req.labels ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          spec.params,
        );
        break;
      default:
        result = await run(spec.prefix ? spec.prefix + req.text : req.text, spec.params);
    }
    self.postMessage({ type: "result", reqId, data: result });
  } catch (e) {
    self.postMessage({ type: "error", reqId, message: (e as Error).message });
  }
});
