// Identity's cryptography on Web Crypto alone (Workers, browsers and Node): keyed hashes for numbers,
// addresses, codes and tokens; ES256 session tokens (compact JWS) with their key set (JWKS); private
// keys sealed with AES-GCM under a key derived from the Worker's IDENTITY_SECRET.
const enc = new TextEncoder();

/** A JSON Web Key (the core builds without the DOM's types). */
export type Jwk = { kty?: string; crv?: string; x?: string; y?: string; d?: string; ext?: boolean; key_ops?: string[]; [k: string]: unknown };
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A random token: `bytes` of entropy, base64url. */
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** A numeric code of `digits` digits, without modulo bias. */
export function randomCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n! < limit) return String(n! % max).padStart(digits, "0");
  }
}

const hmacKeys = new Map<string, Promise<Key>>();
function hmacKey(secret: string) {
  let k = hmacKeys.get(secret);
  if (!k) hmacKeys.set(secret, (k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])));
  return k;
}
/** HMAC-SHA-256 of `purpose:value` under the secret, as hex: lookups without keeping the value. */
export async function keyedHash(secret: string, purpose: string, value: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${purpose}:${value}`)));
}

/** Constant-time comparison of two strings of hex or base64url. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---- sealing private keys --------------------------------------------------------------------------

/**
 * Sealing keys are derived from a secret with HKDF, one per purpose, so a value sealed for one thing
 * (a connector's password) can't be opened as another (a signing key). `purpose` absent is the
 * original single key, which values sealed before purposes existed still use.
 */
async function sealKey(secret: string, purpose?: string) {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("anjal-identity"), info: enc.encode(purpose ? `seal:${purpose}` : "signing-key-seal") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const PURPOSE = /^[a-z][a-z-]{1,30}$/;
/** Seal `text` for one purpose: `v2.<purpose>.<iv>.<ciphertext>`. */
export async function seal(secret: string, text: string, purpose = "signing-key"): Promise<string> {
  if (!PURPOSE.test(purpose)) throw new Error("A sealing purpose is lower-case words.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(purpose) }, await sealKey(secret, purpose), enc.encode(text)));
  return `v2.${purpose}.${b64url(iv)}.${b64url(ct)}`;
}
/** Open a sealed value (current or original format); with `purpose`, only one sealed for it. */
export async function unseal(secret: string, sealed: string, purpose?: string): Promise<string> {
  const parts = sealed.split(".");
  if (parts[0] === "v2" && parts.length === 4) {
    if (purpose && parts[1] !== purpose) throw new Error("This was sealed for something else.");
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(parts[2]!), additionalData: enc.encode(parts[1]!) }, await sealKey(secret, parts[1]), fromB64url(parts[3]!)));
  }
  const [iv, ct] = parts;
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv!) }, await sealKey(secret), fromB64url(ct!)));
}

// ---- ES256 tokens ------------------------------------------------------------------------------------

export type PublicJwk = Jwk & { kid: string; alg: "ES256"; use: "sig" };
const ES256 = { name: "ECDSA", namedCurve: "P-256" } as const;

export async function newSigningKey(): Promise<{ kid: string; publicJwk: PublicJwk; privateJwk: Jwk }> {
  const pair = (await crypto.subtle.generateKey(ES256, true, ["sign", "verify"])) as { publicKey: Key; privateKey: Key };
  const kid = randomToken(9);
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk;
  const priv = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as Jwk;
  return { kid, publicJwk: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid, alg: "ES256", use: "sig" }, privateJwk: priv };
}

export async function signJwt(claims: Record<string, unknown>, kid: string, privateJwk: Jwk): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateJwk as never, ES256, false, ["sign"]);
  const head = b64url(enc.encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

const publicKeys = new Map<string, Promise<Key>>();
/**
 * The claims of a token signed by one of `keys`, or null: a bad signature, an unknown key, another
 * issuer, or expired (`now` in seconds).
 */
export async function verifyJwt<T extends Record<string, unknown>>(token: string, keys: readonly PublicJwk[], { issuer, now = Math.floor(Date.now() / 1000) }: { issuer: string; now?: number }): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const head = JSON.parse(dec.decode(fromB64url(parts[0]!))) as { alg?: string; kid?: string };
    if (head.alg !== "ES256") return null;
    const jwk = keys.find((k) => k.kid === head.kid);
    if (!jwk) return null;
    let key = publicKeys.get(jwk.kid);
    if (!key) publicKeys.set(jwk.kid, (key = crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } as never, ES256, false, ["verify"])));
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await key, fromB64url(parts[2]!), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const claims = JSON.parse(dec.decode(fromB64url(parts[1]!))) as T & { iss?: string; exp?: number };
    if (claims.iss !== issuer || typeof claims.exp !== "number" || claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}
