import { createKiosk, type Kiosk } from "@sekaran-ind/yaxb-core/agent";
import { createVectorizeRetriever } from "@sekaran-ind/yaxb-core/knowledge";
import { createD1FeedbackStore, createD1Kv, createD1ModerationStore, createD1ThreadStore } from "@sekaran-ind/yaxb-core/stores/d1";
import { KvStore } from "@sekaran-ind/yaxb-core/stores/kv";
import { stringEnv, type Bindings } from "./env";

const kiosks = new WeakMap<object, Kiosk>();

/**
 * yaxb-core's kiosk, wired to this Worker: provider keys from secrets, threads, moderation and the
 * agent's long-term store in D1, Vectorize search when VECTORIZE and AI are bound. One instance per
 * isolate, so compiled agents are reused across requests.
 */
export function kiosk(env: Bindings): Kiosk {
  let k = kiosks.get(env);
  if (!k) {
    k = createKiosk({
      env: stringEnv(env),
      threads: createD1ThreadStore(env.DB),
      moderation: createD1ModerationStore(env.DB),
      feedback: createD1FeedbackStore(env.DB),
      // Storage "server": the agent's /memories/ in D1 through Deep Agents' StoreBackend.
      store: new KvStore(createD1Kv(env.DB)),
      vector: env.VECTORIZE && env.AI ? createVectorizeRetriever({ index: env.VECTORIZE, ai: env.AI }) : undefined,
      // Workers Logs. No message content: it may contain health information.
      onError: (error, ctx) =>
        console.error(
          JSON.stringify({
            msg: "kiosk failure",
            ...ctx,
            error: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
            cause: error instanceof Error && error.cause instanceof Error ? `${error.cause.name}: ${String((error.cause as { code?: unknown }).code ?? error.cause.message).slice(0, 120)}` : undefined,
          }),
        ),
    });
    kiosks.set(env, k);
  }
  return k;
}
