// Sealing: encrypting a piece of a case (one step's answers) so only chosen people's devices can read
// it, while every device on the way can still carry it. Hybrid encryption with a lockbox:
//
//   - the data is encrypted once with a random AES-GCM key, bound to where it belongs (`aad`: the case
//     and the step), so a sealed step can't be moved to another case or step;
//   - that key is wrapped separately for each reader: an ephemeral ECDH P-256 key agrees a secret with
//     the reader's public key, HKDF turns it into a wrapping key, AES-GCM wraps the data key.
//
// A reader's key is a device's key pair (a member's device, a starter's device, an administrator's).
// Anyone holding the data key (a reader, opening it) can add readers (`rewrap`): that is how a new
// member of a role is let in, and how a lost device's access is replaced. The server never sees a
// private key. Web Crypto only: it runs in browsers, Workers and Node.
//
// What this does not do: tell you a public key is the right person's. The directory that hands out
// public keys (the business's own server or box) is trusted for that, like any key directory.

/** Web Crypto's key types, typed from crypto.subtle so no DOM types are needed. */
type CryptoKey = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;
type JsonWebKey = { kty?: string; crv?: string; x?: string; y?: string; d?: string; ext?: boolean; key_ops?: string[]; [k: string]: unknown };

export type PublicKey = { id: string; jwk: JsonWebKey };
export type KeyPair = { id: string; jwk: JsonWebKey; privateKey: CryptoKey };
export type WrappedKey = { epk: JsonWebKey; iv: string; wrapped: string };
export type Sealed = { v: 1; iv: string; ct: string; keys: Record<string, WrappedKey> };

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (s: string) => {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
};
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const iv = () => crypto.getRandomValues(new Uint8Array(12));

/** A new device key pair. The private key can be kept as a CryptoKey (not extractable) in IndexedDB; only the public half is shared. */
export async function generateKeyPair(id: string = crypto.randomUUID(), { extractable = false }: { extractable?: boolean } = {}): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  // The private key is re-imported as non-extractable unless a backup was asked for.
  const privateKey = extractable ? pair.privateKey : await crypto.subtle.importKey("jwk", await crypto.subtle.exportKey("jwk", pair.privateKey), ECDH, false, ["deriveBits"]);
  return { id, jwk, privateKey };
}

/** The wrapping key two parties agree on, tied to the reader and to what is sealed. */
async function wrappingKey(priv: CryptoKey, pub: CryptoKey, aad: string, readerId: string): Promise<CryptoKey> {
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: enc.encode(`yaxb-seal-v1|${aad}|${readerId}`) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function wrapFor(dataKey: Uint8Array, aad: string, to: PublicKey): Promise<WrappedKey> {
  const eph = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const pub = await crypto.subtle.importKey("jwk", to.jwk as never, ECDH, false, []);
  const key = await wrappingKey(eph.privateKey, pub, aad, to.id);
  const i = iv();
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv: i, additionalData: enc.encode(`${aad}|${to.id}`) }, key, dataKey);
  return { epk: (await crypto.subtle.exportKey("jwk", eph.publicKey)) as JsonWebKey, iv: b64(i), wrapped: b64(wrapped) };
}

async function unwrap(w: WrappedKey, aad: string, me: Pick<KeyPair, "id" | "privateKey">): Promise<Uint8Array> {
  const epk = await crypto.subtle.importKey("jwk", w.epk as never, ECDH, false, []);
  const key = await wrappingKey(me.privateKey, epk, aad, me.id);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv), additionalData: enc.encode(`${aad}|${me.id}`) }, key, unb64(w.wrapped)));
}

/** Seal `plain` (JSON) for these readers. `aad` says what it belongs to (a case and a step). */
export async function seal(plain: unknown, aad: string, readers: readonly PublicKey[]): Promise<Sealed> {
  if (!readers.length) throw new Error("Nobody could read it.");
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", dataKey, "AES-GCM", false, ["encrypt"]);
  const i = iv();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: i, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(plain)));
  const keys: Record<string, WrappedKey> = {};
  for (const r of readers) keys[r.id] = await wrapFor(dataKey, aad, r);
  return { v: 1, iv: b64(i), ct: b64(ct), keys };
}

/** Can this key open it? (Whether it is among the readers; not whether it is still valid.) */
export const canOpen = (s: Sealed, keyId: string) => Object.hasOwn(s.keys, keyId);

/** Open it with a reader's key, or null when this key isn't a reader or the sealed data was moved or changed. */
export async function open<T = unknown>(s: Sealed, aad: string, me: Pick<KeyPair, "id" | "privateKey">): Promise<T | null> {
  const w = Object.hasOwn(s.keys, me.id) ? s.keys[me.id] : undefined;
  if (!w || s.v !== 1) return null;
  try {
    const dataKey = await unwrap(w, aad, me);
    const key = await crypto.subtle.importKey("raw", dataKey, "AES-GCM", false, ["decrypt"]);
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv), additionalData: enc.encode(aad) }, key, unb64(s.ct)))) as T;
  } catch {
    return null;
  }
}

/** A reader adds readers: the new member of a role, or a replacement device. Needs a key that can open it. */
export async function rewrap(s: Sealed, aad: string, me: Pick<KeyPair, "id" | "privateKey">, add: readonly PublicKey[]): Promise<Sealed | null> {
  const w = Object.hasOwn(s.keys, me.id) ? s.keys[me.id] : undefined;
  if (!w) return null;
  try {
    const dataKey = await unwrap(w, aad, me);
    const keys = { ...s.keys };
    for (const r of add) if (!Object.hasOwn(keys, r.id)) keys[r.id] = await wrapFor(dataKey, aad, r);
    return { ...s, keys };
  } catch {
    return null;
  }
}

/** Take a reader out (a device that was lost or a member who left) so later copies don't carry their lockbox. It can't unread what it already read. */
export const withoutReader = (s: Sealed, keyId: string): Sealed => ({ ...s, keys: Object.fromEntries(Object.entries(s.keys).filter(([id]) => id !== keyId)) });
