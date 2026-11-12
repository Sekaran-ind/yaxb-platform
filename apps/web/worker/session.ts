// Sessions and moderator sign-in, with Web Crypto only.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./index";
import { settings } from "./env";

export const SESSION_COOKIE = "yaxb_sid";
export const MODERATOR_COOKIE = "yaxb_mod";
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

/** The moderator cookie's value: tied to the current token, so rotating MODERATOR_TOKEN signs everyone out. */
export async function moderatorProof(c: Context<AppEnv>): Promise<string | null> {
  const { MODERATOR_TOKEN, SESSION_SECRET } = settings(c.env);
  return MODERATOR_TOKEN ? hmac(SESSION_SECRET, `moderator:${MODERATOR_TOKEN}`) : null;
}

export async function isModerator(c: Context<AppEnv>): Promise<boolean> {
  const proof = await moderatorProof(c);
  const cookie = getCookie(c, MODERATOR_COOKIE);
  return Boolean(proof && cookie && safeEqual(cookie, proof));
}

export function setModeratorCookie(c: Context<AppEnv>, value: string | null) {
  setCookie(c, MODERATOR_COOKIE, value ?? "", { httpOnly: true, sameSite: "Strict", secure: secure(c), path: "/api", maxAge: value ? 8 * 60 * 60 : 0 });
}
