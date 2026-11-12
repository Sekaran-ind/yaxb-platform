// Sessions, moderator and administrator sign-in, with Web Crypto only.
//
// Moderators sign in with their own key (MOD-21): the cookie is the moderator's id and an HMAC
// bound to their current key's hash, so revoking or rotating the key signs them out at once.
// The old shared MODERATOR_TOKEN still works while it is set (its cookie id is "shared").
// The administrator signs in with ADMIN_TOKEN (MOD-23), a different secret with its own cookie.
import type { Moderator, ModeratorService } from "@sekaran-ind/yaxb-core/moderators";
import { statusOf } from "@sekaran-ind/yaxb-core/moderators";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./index";
import { settings } from "./env";

export const SESSION_COOKIE = "yaxb_sid";
export const MODERATOR_COOKIE = "yaxb_mod";
export const ADMIN_COOKIE = "yaxb_admin";
const encoder = new TextEncoder();

export async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const secure = (c: Context) => new URL(c.req.url).protocol === "https:";

/**
 * The visitor's session id, from an httpOnly cookie (issued here on first use). The agent only ever
 * sees an HMAC of it, which namespaces conversation threads so one browser can never read or
 * continue another browser's thread.
 */
export function sessionId(c: Context<AppEnv>): string {
  let sid = getCookie(c, SESSION_COOKIE);
  if (!sid || !/^[0-9a-f-]{36}$/.test(sid)) {
    sid = crypto.randomUUID();
    setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, sameSite: "Lax", secure: secure(c), path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return sid;
}

export async function clientId(c: Context<AppEnv>): Promise<string> {
  return (await hmac(settings(c.env).SESSION_SECRET, `session:${sessionId(c)}`)).slice(0, 32);
}

// ---- moderators -------------------------------------------------------------------------------------

/** Who a signed-in moderator is: their record, or the shared token's stand-in. */
export type ModeratorIdentity = { id: string; name: string; roles: Moderator["roles"]; shared: boolean; moderator: Moderator | null };

const SHARED: Omit<ModeratorIdentity, "moderator"> = { id: "shared", name: "Shared moderator token", roles: ["moderator", "curator"], shared: true };

/** The cookie for a moderator signed in with their key, or with the shared token (moderator null). */
export async function moderatorCookie(c: Context<AppEnv>, moderator: Moderator | null, keyHash: string | null): Promise<string | null> {
  const { SESSION_SECRET, MODERATOR_TOKEN } = settings(c.env);
  if (!moderator) return MODERATOR_TOKEN ? `shared.${await hmac(SESSION_SECRET, `moderator:${MODERATOR_TOKEN}`)}` : null;
  return keyHash ? `${moderator.id}.${await hmac(SESSION_SECRET, `moderator:${moderator.id}:${keyHash}`)}` : null;
}

/** The signed-in moderator, checked against their current key and status on every request. */
export async function moderatorOf(c: Context<AppEnv>, svc: ModeratorService): Promise<ModeratorIdentity | null> {
  const cookie = getCookie(c, MODERATOR_COOKIE);
  const dot = cookie?.indexOf(".") ?? -1;
  if (!cookie || dot < 1) return null;
  const id = cookie.slice(0, dot);
  if (id === "shared") {
    const expected = await moderatorCookie(c, null, null);
    return expected && safeEqual(cookie, expected) ? { ...SHARED, moderator: null } : null;
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [m, keyHash] = await Promise.all([svc.store.get(id), svc.store.keyHashOf(id)]);
  if (!m || !keyHash || statusOf(m) !== "active") return null;
  const expected = await moderatorCookie(c, m, keyHash);
  return expected && safeEqual(cookie, expected) ? { id: m.id, name: m.name, roles: m.roles, shared: false, moderator: m } : null;
}

export function setModeratorCookie(c: Context<AppEnv>, value: string | null) {
  setCookie(c, MODERATOR_COOKIE, value ?? "", { httpOnly: true, sameSite: "Strict", secure: secure(c), path: "/api", maxAge: value ? 8 * 60 * 60 : 0 });
}

// ---- the administrator ------------------------------------------------------------------------------

/** The administrator's cookie value: tied to ADMIN_TOKEN, so changing it signs the administrator out. */
async function adminProof(c: Context<AppEnv>): Promise<string | null> {
  const { ADMIN_TOKEN, SESSION_SECRET } = settings(c.env);
  return ADMIN_TOKEN ? hmac(SESSION_SECRET, `admin:${ADMIN_TOKEN}`) : null;
}

export async function isAdmin(c: Context<AppEnv>): Promise<boolean> {
  const proof = await adminProof(c);
  const cookie = getCookie(c, ADMIN_COOKIE);
  return Boolean(proof && cookie && safeEqual(cookie, proof));
}

export async function setAdminCookie(c: Context<AppEnv>, signedIn: boolean) {
  const value = signedIn ? await adminProof(c) : null;
  setCookie(c, ADMIN_COOKIE, value ?? "", { httpOnly: true, sameSite: "Strict", secure: secure(c), path: "/api", maxAge: value ? 4 * 60 * 60 : 0 });
}
