// The records routes: administrators only, and the import is the free plan's sync.
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { app } from "../index";

const HOST = "https://business.anjalai.cc";
const env = (plan: "free" | "paid", extra: Record<string, unknown> = {}) =>
  ({
    SESSION_SECRET: "s".repeat(40), ADMIN_TOKEN: "a".repeat(40), IDENTITY_SECRET: "i".repeat(40), PLAN: plan, CASES_CENTRAL: "on",
    DB: sqliteD1(), DB_FAMILY: sqliteD1(), DB_BUSINESS: sqliteD1(), DB_COMMUNITY: sqliteD1(), PLATFORM_DB: sqliteD1({ folder: "migrations-platform" }),
    ASSETS: { fetch: async () => new Response("<html></html>") }, FORM_LIMITER: { limit: async () => ({ success: true }) }, CHAT_LIMITER: { limit: async () => ({ success: true }) }, ...extra,
  }) as never;
const headers = (cookie = "") => ({ host: "business.anjalai.cc", origin: HOST, "content-type": "application/json", ...(cookie ? { cookie } : {}) });
async function admin(e: never) {
  const r = await app.request(`${HOST}/api/admin`, { method: "POST", headers: headers(), body: JSON.stringify({ token: "a".repeat(40) }) }, e);
  return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
}
const file = { format: "yaxb-records", version: 1, exported_at: new Date().toISOString(), services: [], cases: [], case_events: [], service_events: [] };
const post = (e: never, cookie: string, body: unknown = file) => app.request(`${HOST}/api/records/import`, { method: "POST", headers: headers(cookie), body: JSON.stringify(body) }, e);

describe("records export and import", () => {
  it("are for administrators", async () => {
    const e = env("free");
    expect((await app.request(`${HOST}/api/records/export`, { headers: headers() }, e)).status).toBe(403);
    expect((await post(e, "")).status).toBe(403);
  });

  it("export gives a file", async () => {
    const e = env("free");
    const r = await app.request(`${HOST}/api/records/export`, { headers: headers(await admin(e)) }, e);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="yaxb-records-/);
    expect(await r.json()).toMatchObject({ format: "yaxb-records", cases: [] });
  });

  it("on the free plan an import spends a sync, and the sixth is refused", async () => {
    const e = env("free");
    const cookie = await admin(e);
    for (let i = 0; i < 5; i++) {
      const r = await post(e, cookie);
      expect(r.status).toBe(200);
      expect(((await r.json()) as { sync: { left: number } }).sync.left).toBe(4 - i);
    }
    const sixth = await post(e, cookie);
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as { error: string }).error).toMatch(/5 syncs a year/);
  });

  it("a file it can't read spends nothing", async () => {
    const e = env("free");
    const cookie = await admin(e);
    expect((await post(e, cookie, { format: "nope" })).status).toBe(422);
    expect(((await (await post(e, cookie)).json()) as { sync: { left: number } }).sync.left).toBe(4);
  });

  it("on the paid plan an import spends none", async () => {
    const e = env("paid");
    const r = await post(e, await admin(e));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { sync: unknown }).sync).toBeNull();
  });
});
