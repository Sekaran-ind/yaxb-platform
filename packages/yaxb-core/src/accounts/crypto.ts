// Encryption for kiosk profiles, from clinux-diary's lib/crypto.js. A profile on a shared kiosk is
// exactly where plain browser storage isn't good enough.
//
//   passphrase --PBKDF2-SHA256 (600,000 iterations, 16-byte random salt)--> AES-GCM 256 key
//   the profile and its activity log --AES-GCM, fresh 12-byte IV--> { iv, ct } (base64)
//
// The key is non-extractable and lives only in memory while the profile is open. There is no
// recovery: without the passphrase the profile can't be read by anyone. Web Crypto only, so it
// runs the same in the browser, Workers and Node.
export const PBKDF2_ITERATIONS = 600_000; // OWASP's figure for PBKDF2-HMAC-SHA256

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export type Sealed = { iv: string; ct: string };
/** Web Crypto's CryptoKey (typed from crypto.subtle, so no DOM types are needed). */
export type Key = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Key> {
  const material = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptJson(key: Key, value: unknown): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(JSON.stringify(value))));
  return { iv: toBase64(iv), ct: toBase64(ct) };
}

/** Throws if the key is wrong or the data was altered (AES-GCM's tag check). */
export async function decryptJson<T = unknown>(key: Key, box: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(box.iv) }, key, fromBase64(box.ct));
  return JSON.parse(dec.decode(plain)) as T;
}

/**
 * A locked profile as stored: the nickname in the clear (to pick it from a list on the kiosk), the
 * salt and iteration count, and everything else sealed.
 */
export type VaultRecord = { id: string; nickname: string; createdAt: string; salt: string; iterations: number; box: Sealed };

export async function createVault<T>(id: string, nickname: string, passphrase: string, data: T, { iterations = PBKDF2_ITERATIONS, now = new Date() } = {}) {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt, iterations);
  const record: VaultRecord = { id, nickname, createdAt: now.toISOString(), salt: toBase64(salt), iterations, box: await encryptJson(key, data) };
  return { record, key };
}

/** The key and data, or null when the passphrase is wrong. */
export async function openVault<T>(record: VaultRecord, passphrase: string): Promise<{ key: Key; data: T } | null> {
  const key = await deriveKey(passphrase, fromBase64(record.salt), record.iterations);
  try {
    return { key, data: await decryptJson<T>(key, record.box) };
  } catch {
    return null;
  }
}

/** The record with new data under the same key. */
export async function sealVault<T>(record: VaultRecord, key: Key, data: T, nickname = record.nickname): Promise<VaultRecord> {
  return { ...record, nickname, box: await encryptJson(key, data) };
}

/** A new salt and key for a new passphrase, with the same data. */
export async function rekeyVault<T>(record: VaultRecord, passphrase: string, data: T, { iterations = PBKDF2_ITERATIONS } = {}) {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt, iterations);
  return { record: { ...record, salt: toBase64(salt), iterations, box: await encryptJson(key, data) } as VaultRecord, key };
}
