// Limits on who may spend what (Phase 0). Cloudflare's rate-limit binding handles bursts (a minute);
// the free tier's few questions per IP over 40 minutes, the deployment's daily model budget and wrong
// case references are counted here, in the platform database (shared by every edition), by hashed IP.
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

const minutes = (m: number) => Math.ceil(m / 60_000);
export type ModelGate = { ok: true; free: boolean; selection: { provider: string; model: string } | null } | { ok: false; status: 429 | 503; message: string; retryAfterS?: number };

/**
 * May this caller ask the hosted model? A signed-in member of a business always may (their own
 * choice of model). Anyone else is the free tier: FREE_TIER_QUESTIONS per IP per window, on the free
 * tier's small model, and within the deployment's daily budget. `member` is whether they are one.
 */
export async function modelGate(c: Context, env: Bindings, member: boolean): Promise<ModelGate> {
  const s = settings(env);
  if (member || s.FREE_TIER_QUESTIONS === 0) return { ok: true, free: false, selection: null };
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
      return { ok: false, status: 429, retryAfterS: Math.ceil(r.retryAfterMs / 1000), message: `The free tier allows ${s.FREE_TIER_QUESTIONS} AI questions every ${s.FREE_TIER_WINDOW_MINUTES} minutes. Try again in about ${wait} minute${wait === 1 ? "" : "s"}, or use Kiosk only answers, which have no limit.` };
    }
  }
  if (s.FREE_TIER_DAILY > 0) await q.take(day, budget);
  return { ok: true, free: true, selection };
}
