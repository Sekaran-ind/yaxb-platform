// A business's own sign-in (IDN-15): any OpenID Connect provider found by discovery. A fake provider
// here (discovery, token endpoint, JWKS) with ID tokens signed by a real key.
import { describe, expect, it } from "vitest";
import { b64url, createIdentityService, createMemoryIdentityStore, oidcFinish, oidcStart, orgProviderId, type OidcProvider } from "../src/identity/index.js";
import { newSigningKey, signJwt } from "../src/identity/crypto.js";
import { createD1IdentityStore } from "../src/identity/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const ISSUER = "https://login.example-company.test/tenant-1/v2.0";
async function fakeProvider(claims: Record<string, unknown>) {
  const key = await newSigningKey();
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname.endsWith("/.well-known/openid-configuration"))
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys`, id_token_signing_alg_values_supported: ["ES256"], response_types_supported: ["code"], subject_types_supported: ["public"] });
    if (url.pathname.endsWith("/keys")) return Response.json({ keys: [key.publicJwk] });
    if (url.pathname.endsWith("/token")) {
      const form = new URLSearchParams(String(init?.body));
      const c = codes.get(form.get("code") ?? "");
      if (!c || form.get("client_secret") !== "s3cret") return Response.json({ error: "invalid_grant" }, { status: 400 });
      const verifier = form.get("code_verifier") ?? "";
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      if (challenge !== c.challenge) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const t = Math.floor(Date.now() / 1000);
      const id_token = await signJwt({ iss: ISSUER, aud: "client-1", iat: t, exp: t + 300, nonce: c.nonce, ...claims }, key.kid, key.privateJwk);
      return Response.json({ access_token: "at", token_type: "Bearer", id_token });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, codes };
}

describe("a business's own sign-in (IDN-15)", () => {
  it("signs a staff member in through the provider, with PKCE, state and nonce", async () => {
    const { fetchImpl, codes } = await fakeProvider({ sub: "staff-42", name: "Meena", preferred_username: "meena@company" });
    const p: OidcProvider = { id: orgProviderId("business", "t1"), issuer: ISSUER, clientId: "client-1", clientSecret: "s3cret", redirectUri: "https://business.anjalai.cc/api/identity/org/callback" };
    const { url, pending } = await oidcStart(p, { fetchImpl });
    const sent = new URL(url);
    expect(sent.origin + sent.pathname).toBe(`${ISSUER}/authorize`);
    expect(sent.searchParams.get("code_challenge_method")).toBe("S256");
    codes.set("code-1", { nonce: sent.searchParams.get("nonce")!, challenge: sent.searchParams.get("code_challenge")! });
    const back = new URL(`${p.redirectUri}?code=code-1&state=${pending.state}`);
    const who = await oidcFinish(p, back, pending, { fetchImpl });
    expect(who).toMatchObject({ subject: "staff-42", emailVerified: false, name: "Meena" });
    // A forged state is refused.
    await expect(oidcFinish(p, new URL(`${p.redirectUri}?code=code-1&state=wrong`), pending, { fetchImpl })).rejects.toThrow();

    // The business's provider vouches for its staff: no verified email needed.
    const id = createIdentityService(createMemoryIdentityStore(), { secret: "test-secret-0123456789", issuer: "https://anjalai.cc" });
    await expect(id.oidcSignIn({ provider: p.id, label: "Sri Ram Hardware", subject: who.subject, email: null, emailVerified: false, consent: true })).rejects.toThrow(/isn't verified/);
    const r = await id.oidcSignIn({ provider: p.id, label: "Sri Ram Hardware", requireEmail: false, subject: who.subject, email: null, emailVerified: false, consent: true, name: "Meena" });
    if (!("session" in r)) throw new Error();
    expect((await id.me(r.account.id)).methods.map((m) => m.display)).toContain("Sri Ram Hardware · your account");
    // The same person next time: the same account.
    const again = await id.oidcSignIn({ provider: p.id, label: "Sri Ram Hardware", requireEmail: false, subject: "staff-42", email: null, emailVerified: false });
    expect("session" in again && again.account.id).toBe(r.account.id);
  });

  for (const [name, make] of [
    ["memory", () => createMemoryIdentityStore()],
    ["D1", () => createD1IdentityStore(sqliteD1({ folder: "migrations-platform" }))],
  ] as const)
  it(`keeps a space's provider with its secret sealed, on ${name}`, async () => {
    const store = make();
    const id = createIdentityService(store, { secret: "test-secret-0123456789", issuer: "https://anjalai.cc" });
    await expect(id.setSpaceOidc("business", "t1", { issuer: "http://evil.test", client_id: "c", client_secret: "s", label: "X", default_role: "moderator" }, null)).rejects.toThrow(/https/);
    await expect(id.setSpaceOidc("business", "t1", { issuer: ISSUER, client_id: "c", label: "X", default_role: "moderator" }, null)).rejects.toThrow(/client secret/);
    const v = await id.setSpaceOidc("business", "t1", { issuer: ISSUER, client_id: "client-1", client_secret: "s3cret", label: "Sri Ram Hardware", default_role: "moderator" }, null);
    expect(v).not.toHaveProperty("sealed_secret");
    expect(JSON.stringify(await store.spaceOidc("business", "t1"))).not.toContain("s3cret");
    // Changing it without a secret keeps the old one.
    await id.setSpaceOidc("business", "t1", { issuer: ISSUER, client_id: "client-1", label: "Sri Ram", default_role: "reviewer" }, null);
    const p = await id.spaceOidcProvider("business", "t1", "https://x/cb");
    expect(p).toMatchObject({ clientSecret: "s3cret", label: "Sri Ram", defaultRole: "reviewer", id: "org:business:t1" });
    expect(await id.removeSpaceOidc("business", "t1", null)).toBe(true);
    expect(await id.spaceOidc("business", "t1")).toBeNull();
    // A provider on this computer may be http (a developer's test provider).
    await id.setSpaceOidc("business", "t2", { issuer: "http://localhost:4400", client_id: "c", client_secret: "s", label: "Test", default_role: "moderator" }, null);
  });
});
