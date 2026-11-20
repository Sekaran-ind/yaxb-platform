// Who may call what (Phase 0). The Worker has well over a hundred routes; this asks every one of them
// as an anonymous caller from the site's own origin and pins the kind of answer in
// authorization.snapshot.json:
//   refused  401 or 403: needs someone signed in
//   paid     402: needs the paid plan
//   open     2xx or 3xx: anyone may call it (so it must be on purpose)
//   input    400, 404, 409, 413, 422, 429: it looked at the request before it looked at who asked, so
//            this probe can't tell; the targeted checks below cover the sensitive ones with real input
//   error    5xx
// A route that stops refusing, a new route nobody has looked at, or a removed one fails here. After
// checking the change is meant, update the snapshot: UPDATE_ROUTE_SNAPSHOT=1 npm run test:worker
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { app } from "../index";

const SNAPSHOT = new URL("./authorization.snapshot.json", import.meta.url);
const HOST = "https://business.anjalai.cc";
const env = () =>
  ({
    SESSION_SECRET: "s".repeat(40),
    ADMIN_TOKEN: "a".repeat(40),
    IDENTITY_SECRET: "i".repeat(40),
    CASES_CENTRAL: "on",
    DB: sqliteD1(),
    DB_FAMILY: sqliteD1(),
    DB_BUSINESS: sqliteD1(),
    DB_COMMUNITY: sqliteD1(),
    PLATFORM_DB: sqliteD1({ folder: "migrations-platform" }),
    ASSETS: { fetch: async () => new Response("<html></html>") },
  }) as never;

const kind = (status: number) => (status === 401 || status === 403 ? "refused" : status === 402 ? "paid" : status < 400 ? "open" : status < 500 ? "input" : "error");
const anonymous = (path: string, method: string, e: never, body: unknown = {}) =>
  app.request(`${HOST}${path}`, { method, headers: { origin: HOST, host: "business.anjalai.cc", "content-type": "application/json" }, ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body) }) }, e);

describe("authorization", () => {
  it("every route answers an anonymous caller as the snapshot says", async () => {
    const e = env();
    const seen = new Set<string>();
    const now: Record<string, string> = {};
    for (const r of app.routes) {
      if (r.method === "ALL" || r.path.includes("*")) continue;
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let status = 599;
      try {
        status = (await anonymous(r.path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, "x"), r.method, e)).status;
      } catch {
        status = 599;
      }
      now[key] = kind(status);
    }
    const sorted = Object.fromEntries(Object.entries(now).sort(([a], [b]) => a.localeCompare(b)));
    if (process.env.UPDATE_ROUTE_SNAPSHOT || !existsSync(SNAPSHOT)) {
      writeFileSync(SNAPSHOT, `${JSON.stringify(sorted, null, 2)}\n`);
      return;
    }
    const before = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, string>;
    const changed = Object.keys({ ...before, ...sorted }).filter((k) => before[k] !== sorted[k]).map((k) => `${k}: ${before[k] ?? "(new route)"} -> ${sorted[k] ?? "(gone)"}`);
    expect(changed, "A route's answer to an anonymous caller changed. If that is meant, rerun with UPDATE_ROUTE_SNAPSHOT=1").toEqual([]);
  });

  it("nothing that changes a business or its people is open to an anonymous caller", async () => {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, string>;
    // Open on purpose, each for a reason:
    //  - they only say who is asking (admin, moderator, tenant, identity me/config/jwks) or sign someone out;
    //  - they start signing in (passkey, Google, company sign-in, the app, a phone's QR);
    //  - visitors use them (a case list is empty for a visitor; the library shows a visitor their own drafts);
    //  - they are public lists (directory, published services, templates, approved sites);
    //  - the relay's envelopes are addressed by a secret; routine notices and approvals are by role (none, here);
    //  - DELETE device-lock does nothing on a device that isn't locked (a locked one needs its administrator).
    const OPEN_BY_DESIGN = new Set([
      "GET /api/admin", "DELETE /api/admin", "GET /api/moderator", "DELETE /api/moderator", "GET /api/tenant", "GET /api/directory",
      "GET /api/identity/config", "GET /api/identity/jwks", "GET /api/identity/me", "POST /api/identity/signout", "POST /api/identity/app/signout",
      "GET /api/identity/google/start", "GET /api/identity/google/callback", "GET /api/identity/org/start", "GET /api/identity/org/callback",
      "POST /api/identity/passkey/register/start", "POST /api/identity/passkey/signin/start", "POST /api/identity/app/start", "POST /api/identity/handoff/start",
      "DELETE /api/identity/device-lock",
      "GET /api/cases", "GET /api/library", "GET /api/library/design", "GET /api/library/published", "GET /api/library/templates", "GET /api/sites",
      "GET /api/relay", "GET /api/relay/status", "GET /api/routines/approvals", "GET /api/routines/notices", "GET /yaxb",
    ]);
    const open = Object.entries(snap).filter(([, k]) => k === "open").map(([r]) => r);
    expect(open.filter((r) => !OPEN_BY_DESIGN.has(r)), "Routes open to anyone that aren't on the reviewed list").toEqual([]);
  });

  it("the sensitive routes refuse an anonymous caller even with a valid request", async () => {
    const e = env();
    const cases: [string, string, unknown][] = [
      ["POST", "/api/sites/s1/status", { status: "paused" }],
      ["POST", "/api/sites/requests/r1/approve", {}],
      ["POST", "/api/sites/own", { origin: "https://example.com", paths: ["/"], region: "IN", category: "news", uses: ["source"] }],
      ["POST", "/api/links", { business: "other" }],
      ["POST", "/api/tenant/join-links", { role: "moderator" }],
      ["GET", "/api/tenant/join-requests", null],
      ["POST", "/api/library/lessons", { text: "Always ask for a phone number" }],
      ["GET", "/api/library/lessons", null],
      ["GET", "/api/reviews/answers", null],
      ["GET", "/api/reviews/scores", null],
      ["GET", "/api/agent/moderation", null],
      ["GET", "/api/agent/feedback", null],
      ["GET", "/api/admin/moderators", null],
      ["GET", "/api/admin/audit", null],
      ["GET", "/api/admin/audit/chain", null],
      ["POST", "/api/routines/dry-run", { yaml: "kind: routine" }],
      ["PUT", "/api/routines/settings", { paused: true }],
      ["GET", "/api/team", null],
      ["GET", "/api/identity/devices", null],
      ["GET", "/api/identity/sessions", null],
      ["PUT", "/api/identity/space-policy", { methods: ["passkey"] }],
    ];
    const open: string[] = [];
    for (const [method, path, body] of cases) {
      const status = (await anonymous(path, method, e, body ?? {})).status;
      if (status !== 401 && status !== 403 && status !== 404 && status !== 503) open.push(`${method} ${path} -> ${status}`);
    }
    expect(open).toEqual([]);
  });
});
