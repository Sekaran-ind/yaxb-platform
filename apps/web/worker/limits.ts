// Limits on who may spend what. Cloudflare's rate-limit binding handles bursts (a minute); the free
// plan's few questions per IP over 40 minutes, the deployment's daily model budget and wrong case
// references are counted here, in the platform database (shared by every edition), by hashed IP.
//
// Plans: the paid plan is its own deployment on a paid Cloudflare Workers plan (PLAN=paid), where
// none of this applies. The free deployment treats everyone alike (a signed-in member of a business
// is still the free plan): a few short questions to a small model, and a move to the paid plan for
// anything longer.
import type { Context } from "hono";
import { freeTierSelection } from "@sekaran-ind/yaxb-core/providers";
import { createD1QuotaStore, createMemoryQuotaStore, createQuota, ipKey, type Quota } from "@sekaran-ind/yaxb-core/quota";
import { settings, stringEnv, type Bindings } from "./env";

const quotas = new WeakMap<object, Quota>();
/** The platform database's counters, or this isolate's memory where there is no platform database (a local run). */
export function quota(env: Bindings): Quota {
  let q = quotas.get(env);
  if (!q) quotas.set(env, (q = createQuota(env.PLATFORM_DB ? createD1QuotaStore(env.PLATFORM_DB as D1Database) : createMemoryQuotaStore())));
  return q;
}

/** The caller's address as a hashed key, or null with no address (a local run: not limited). */
export const callerKey = (c: Context, env: Bindings) => ipKey(c.req.header("cf-connecting-ip"), settings(env).SESSION_SECRET);

/** Whether this deployment applies the free plan's limits. */
export const freePlan = (env: Bindings) => settings(env).PLAN === "free" && settings(env).FREE_TIER_QUESTIONS > 0;

/** What the free plan allows, in words and numbers, for Preferences. */
export function freePlanInfo(env: Bindings) {
  const s = settings(env);
  return freePlan(env) ? { questions: s.FREE_TIER_QUESTIONS, minutes: s.FREE_TIER_WINDOW_MINUTES, words: wordsFor(s.FREE_TIER_MAX_TOKENS), chars: s.FREE_TIER_MAX_QUESTION_CHARS, upgrade: s.UPGRADE_URL ?? null } : null;
}
/** About how many words fit in the token cap, leaving room so a reply isn't cut off in a sentence. */
const wordsFor = (tokens: number) => Math.max(40, Math.floor(tokens * 0.4));

const minutes = (m: number) => Math.ceil(m / 60_000);
const more = (env: Bindings) => (settings(env).UPGRADE_URL ? ` Move to the paid plan: ${settings(env).UPGRADE_URL}` : " Move to the paid plan to continue.");

export type ModelGate = { ok: true; free: boolean; selection: { provider: string; model: string } | null; brief?: { maxTokens: number; words: number } } | { ok: false; status: 402 | 413 | 429 | 503; message: string; retryAfterS?: number };

/**
 * May this caller ask the hosted model? On the paid deployment, yes, as they choose. On the free one
 * (everyone, members too), only a short question (`chars`) to the small model with a short answer,
 * FREE_TIER_QUESTIONS per IP per window, within the day's budget. `long` marks a request whose
 * answer is long by nature (a whole service drafted by AI): that is the paid plan.
 */
export async function modelGate(c: Context, env: Bindings, { chars = 0, long = false }: { chars?: number; long?: boolean } = {}): Promise<ModelGate> {
  const s = settings(env);
  if (!freePlan(env)) return { ok: true, free: false, selection: null };
  if (long) return { ok: false, status: 402, message: `Drafting a whole service with AI is part of the paid plan.${more(env)} You can still design it by hand, or ask a short question here.` };
  if (chars > s.FREE_TIER_MAX_QUESTION_CHARS) return { ok: false, status: 413, message: `The free plan takes questions up to ${s.FREE_TIER_MAX_QUESTION_CHARS} characters. Shorten it, or a longer question is part of the paid plan.${more(env)}` };
  const selection = freeTierSelection(stringEnv(env));
  if (!selection) return { ok: false, status: 503, message: "The free AI model isn't available right now. Kiosk only answers still work: choose \"Kiosk only (no AI model)\" in Preferences." };
  const q = quota(env);
  const day = `day:${new Date().toISOString().slice(0, 10)}`;
  const budget = { limit: s.FREE_TIER_DAILY, windowMs: 86_400_000 };
  if (s.FREE_TIER_DAILY > 0 && !(await q.allows(day, budget))) return { ok: false, status: 503, message: "The free AI model has been used up for today. Kiosk only answers still work, and it opens again tomorrow." };
  const key = await callerKey(c, env);
  if (key) {
    const rule = { limit: s.FREE_TIER_QUESTIONS, windowMs: s.FREE_TIER_WINDOW_MINUTES * 60_000 };
    const r = await q.take(`free:${key}`, rule);
    if (!r.ok) {
      const wait = minutes(r.retryAfterMs);
      return { ok: false, status: 429, retryAfterS: Math.ceil(r.retryAfterMs / 1000), message: `The free plan allows ${s.FREE_TIER_QUESTIONS} AI questions every ${s.FREE_TIER_WINDOW_MINUTES} minutes. Try again in about ${wait} minute${wait === 1 ? "" : "s"}, use Kiosk only answers (no limit), or move to the paid plan.${s.UPGRADE_URL ? ` ${s.UPGRADE_URL}` : ""}` };
    }
  }
  if (s.FREE_TIER_DAILY > 0) await q.take(day, budget);
  return { ok: true, free: true, selection, brief: { maxTokens: s.FREE_TIER_MAX_TOKENS, words: wordsFor(s.FREE_TIER_MAX_TOKENS) } };
}
