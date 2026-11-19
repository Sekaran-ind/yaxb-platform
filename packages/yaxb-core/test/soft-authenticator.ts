// A software passkey for tests: makes real WebAuthn registration and authentication responses
// (attestation "none", ES256), so the identity service's checks run unmocked.
import { b64url, fromB64url } from "../src/identity/crypto.js";

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const enc = new TextEncoder();

// ---- a minimal CBOR encoder (maps, byte strings, text, small ints) ------------------------------------
function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  return [(major << 5) | 25, n >> 8, n & 255];
}
function cbor(v: unknown): number[] {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") {
    const b = [...enc.encode(v)];
    return [...head(3, b.length), ...b];
  }
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  if (v instanceof Map) return [...head(5, v.size), ...[...v].flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
  throw new Error("cbor: unsupported");
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) (out.set(p, i), (i += p.length));
  return out;
};
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));

/** Raw r||s (Web Crypto) to DER (WebAuthn's ES256 signatures). */
function der(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let x = b.slice(i);
    if (x[0]! & 0x80) x = concat(new Uint8Array([0]), x);
    return concat(new Uint8Array([2, x.length]), x);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export async function softAuthenticator(rpId: string, origin: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as { publicKey: Key; privateKey: Key };
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as { x: string; y: string };
  const credId = crypto.getRandomValues(new Uint8Array(16));
  let counter = 0;
  let userHandle: Uint8Array | null = null;

  const authData = async (attested: boolean) => {
    const flags = 0x01 | 0x04 | (attested ? 0x40 : 0); // user present, user verified, attested data
    const count = new Uint8Array([(counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255]);
    const base = concat(await sha256(enc.encode(rpId)), new Uint8Array([flags]), count);
    if (!attested) return base;
    const cose = new Uint8Array(cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, fromB64url(jwk.x)], [-3, fromB64url(jwk.y)]])));
    return concat(base, new Uint8Array(16), new Uint8Array([0, credId.length]), credId, cose);
  };
  const clientData = (type: string, challenge: string) => enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id: b64url(credId),
    /** A registration response to `navigator.credentials.create` options. */
    async register(options: { challenge: string; user: { id: string } }) {
      userHandle = fromB64url(options.user.id);
      const attestationObject = new Uint8Array(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", await authData(true)]])));
      return {
        id: b64url(credId),
        rawId: b64url(credId),
        type: "public-key" as const,
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientData("webauthn.create", options.challenge)), attestationObject: b64url(attestationObject), transports: ["internal" as const] },
      };
    },
    /** An authentication response to `navigator.credentials.get` options. */
    async authenticate(options: { challenge: string }) {
      counter++;
      const data = await authData(false);
      const cd = clientData("webauthn.get", options.challenge);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, concat(data, await sha256(cd))));
      return {
        id: b64url(credId),
        rawId: b64url(credId),
        type: "public-key" as const,
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(cd), authenticatorData: b64url(data), signature: b64url(der(raw)), userHandle: userHandle ? b64url(userHandle) : undefined },
      };
    },
  };
}
