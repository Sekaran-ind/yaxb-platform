import { createKiosk, type Kiosk } from "@sekaran-ind/yaxb-core/agent";
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import { createLibraryService, type LibraryService } from "@sekaran-ind/yaxb-core/library";
import { createVectorizeRetriever } from "@sekaran-ind/yaxb-core/knowledge";
import { createModeratorService, type ModeratorService } from "@sekaran-ind/yaxb-core/moderators";
import { createReviewService, type ReviewService } from "@sekaran-ind/yaxb-core/reviews";
import { createD1FeedbackStore, createD1Kv, createD1LibraryStore, createD1ModerationStore, createD1ModeratorStore, createD1ReviewStore, createD1ThreadStore } from "@sekaran-ind/yaxb-core/stores/d1";
import { KvStore } from "@sekaran-ind/yaxb-core/stores/kv";
import { stringEnv, type Bindings } from "./env";

const kiosks = new WeakMap<object, Kiosk>();
const moderatorServices = new WeakMap<object, ModeratorService>();
const reviewServices = new WeakMap<object, ReviewService>();
const libraryServices = new WeakMap<object, LibraryService>();

/** The journey library in D1 (LIB-1..12), checked against this kiosk's handlers and screens; audited with the moderators' log. */
export function library(env: Bindings): LibraryService {
  let l = libraryServices.get(env);
  if (!l) {
    const audit = moderators(env).store;
    l = createLibraryService(createD1LibraryStore(env.DB), { services: JOURNEY_SERVICES, screens: kioskContent.screens.screens.map((s) => s.id), audit: (e) => audit.audit(e) });
    libraryServices.set(env, l);
  }
  return l;
}

/** Answers sent for review and moderators' reviews, in D1 (MOD-10..13, MOD-30..34). */
export function reviews(env: Bindings): ReviewService {
  let r = reviewServices.get(env);
  if (!r) reviewServices.set(env, (r = createReviewService(createD1ReviewStore(env.DB), moderators(env).store)));
  return r;
}

/** Moderators, their keys and profiles, and the audit log, in D1 (MOD-20..25). */
export function moderators(env: Bindings): ModeratorService {
  let m = moderatorServices.get(env);
  if (!m) moderatorServices.set(env, (m = createModeratorService(createD1ModeratorStore(env.DB))));
  return m;
}

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
