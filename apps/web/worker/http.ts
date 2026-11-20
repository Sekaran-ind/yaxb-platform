// Shared HTTP helpers for the Worker's routes: errors, same-origin and rate-limit checks, JSON bodies.
import { createMemoryRateLimiter } from "@sekaran-ind/yaxb-core/stores";
import { type Context } from "hono";
import { callerKey, type ModelGate } from "./limits";
import { fromApp } from "./session";
import type { AppEnv } from "./app";

export const MAX_CHAT_BODY = 4_500_000;
export const MAX_FORM_BODY = 64_000;

// ---- helpers -------------------------------------------------------------------------------------

export const jsonError = (c: Context<AppEnv>, status: number, message: string) => {
  c.header("Cache-Control", "no-store");
  return c.json({ error: message }, status as 400);
};

/**
 * CSRF defence for state-changing routes: the request must come from our own origin, or from the
 * native app (PLT-14), which carries no cookies (its session is a header), so it can't be forged
 * from another site.
 */
export function sameOrigin(c: Context<AppEnv>): boolean {
  // A machine's key or a device's credential is a bearer token another site's page can't send
  // (browsers never add it), so no CSRF.
  if (c.get("machine") || c.get("device")) return true;
  const origin = c.req.header("origin");
  if (!origin) return false;
  if (fromApp(c)) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

export const ip = (c: Context<AppEnv>) => c.req.header("cf-connecting-ip") ?? "local";

// Used only when the Rate Limiting bindings are absent.
export const fallbacks = { chat: createMemoryRateLimiter({ limit: 20 }), form: createMemoryRateLimiter({ limit: 5 }) };
export async function withinLimit(kind: keyof typeof fallbacks, limiter: RateLimit | undefined, key: string) {
  if (limiter) return (await limiter.limit({ key: `${kind}:${key}` })).success;
  return fallbacks[kind].limit(`${kind}:${key}`);
}

/**
 * A burst limit per IP address as well as per session: a caller who throws their cookie away gets a
 * new session every time, so the session alone limits nothing. No address (a local run): not limited.
 */
export async function withinIpBurst(c: Context<AppEnv>, purpose: string) {
  const key = await callerKey(c, c.env);
  return !key || (await withinLimit("chat", c.env.CHAT_LIMITER, `ip:${purpose}:${key}`));
}
export const refusal = (c: Context<AppEnv>, g: Extract<ModelGate, { ok: false }>) => {
  if (g.retryAfterS) c.header("Retry-After", String(g.retryAfterS));
  return jsonError(c, g.status, g.message);
};

/** Read a JSON body up to a size; null when it's missing, too large or not JSON. */
export async function readJson(c: Context<AppEnv>, max: number): Promise<{ body: unknown; tooLarge: boolean }> {
  if (Number(c.req.header("content-length") ?? 0) > max) return { body: null, tooLarge: true };
  const raw = await c.req.text().catch(() => "");
  if (raw.length > max) return { body: null, tooLarge: true };
  try {
    return { body: JSON.parse(raw), tooLarge: false };
  } catch {
    return { body: null, tooLarge: false };
  }
}
