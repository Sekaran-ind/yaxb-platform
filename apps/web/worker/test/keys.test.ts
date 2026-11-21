// The key directory routes: members and the administrator list a device's public key; nobody else.
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { generateKeyPair } from "@sekaran-ind/yaxb-core/seal";
import { app } from "../index";

const HOST = "https://business.anjalai.cc";
const env = () =>
  ({
    SESSION_SECRET: "s".repeat(40), ADMIN_TOKEN: "a".repeat(40), IDENTITY_SECRET: "i".repeat(40),
    DB: sqliteD1(), DB_FAMILY: sqliteD1(), DB_BUSINESS: sqliteD1(), DB_COMMUNITY: sqliteD1(), PLATFORM_DB: sqliteD1({ folder: "migrations-platform" }),
    ASSETS: { fetch: async () => new Response("<html></html>") }, FORM_LIMITER: { limit: async () => ({ success: true }) }, CHAT_LIMITER: { limit: async () => ({ success: true }) },
  }) as never;
const headers = (cookie = "") => ({ host: "business.anjalai.cc", origin: HOST, "content-type": "application/json", ...(cookie ? { cookie } : {}) });
const admin = async (e: never) => ((await app.request(`${HOST}/api/admin`, { method: "POST", headers: headers(), body: JSON.stringify({ token: "a".repeat(40) }) }, e)).headers.get("set-cookie") ?? "").split(";")[0]!;
const put = (e: never, cookie: string, body: unknown) => app.request(`${HOST}/api/keys`, { method: "PUT", headers: headers(cookie), body: JSON.stringify(body) }, e);

describe("the key directory", () => {
  it("lists the administrator's device and gives it back, public part only", async () => {
    const e = env();
    const cookie = await admin(e);
    const k = await generateKeyPair("admin-laptop");
    expect((await put(e, cookie, { id: k.id, jwk: k.jwk })).status).toBe(200);
    const got = (await (await app.request(`${HOST}/api/keys/directory?roles=nurse`, { headers: headers(cookie) }, e)).json()) as { keys: unknown[]; admins: { id: string; jwk: Record<string, unknown> }[] };
    expect(got.keys).toEqual([]);
    expect(got.admins.map((a) => a.id)).toEqual(["admin-laptop"]);
    expect(got.admins[0]!.jwk).not.toHaveProperty("d");
  });

  it("gives a visitor the public keys (they seal what they gave before it leaves their device), but takes none from them", async () => {
    const e = env();
    const cookie = await admin(e);
    const k = await generateKeyPair("admin-laptop");
    await put(e, cookie, { id: k.id, jwk: k.jwk });
    const seen = (await (await app.request(`${HOST}/api/keys/directory?roles=nurse`, { headers: headers() }, e)).json()) as { admins: { id: string }[] };
    expect(seen.admins.map((a) => a.id)).toEqual(["admin-laptop"]);
    expect((await put(e, "", { id: k.id, jwk: k.jwk })).status).toBe(403);
  });

  it("refuses a key with a private part", async () => {
    const e = env();
    const k = await generateKeyPair("visitor-dev", { extractable: true });
    const cookie = await admin(e);
    const priv = await crypto.subtle.exportKey("jwk", k.privateKey);
    const r = await put(e, cookie, { id: k.id, jwk: priv });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toMatch(/private/);
  });
});
