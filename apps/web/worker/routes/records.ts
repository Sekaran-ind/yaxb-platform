// Routes: records. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
// A business's runtime data (cases, their events, service events) out as a file and back in
// (docs/architecture/hardening.md, step 4). Its services and configuration stay on the server and are
// not part of the file. Administrators only; the import is the free plan's "sync" and spends one.
import { app } from "../app";
import { db } from "../edition";
import { settings } from "../env";
import { currentTenant } from "../kiosk";
import { permissionsOf } from "@sekaran-ind/yaxb-core/library";
import { exportRecords, importRecords, MAX_RECORDS_BYTES, parseRecords, RecordsError } from "@sekaran-ind/yaxb-core/records";
import type { D1Like } from "@sekaran-ind/yaxb-core/stores/d1";
import { libraryActor } from "../actors";
import { jsonError, readJson, sameOrigin, withinLimit } from "../http";
import { takeSync } from "../sync-allowance";

const manages = async (c: Parameters<typeof libraryActor>[0]) => {
  const a = await libraryActor(c);
  return permissionsOf(a).manage ? a : null;
};

/** The business's runtime data as a file; `?service=<entry id>` for one service (a file holds at most 5000 rows). */
app.get("/api/records/export", async (c) => {
  const actor = await manages(c);
  if (!actor) return jsonError(c, 403, "Only an administrator exports a business's records.");
  try {
    const bundle = await exportRecords(db(c.env) as unknown as D1Like, currentTenant(), { service: c.req.query("service") || undefined });
    return new Response(JSON.stringify(bundle), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="yaxb-records-${bundle.exported_at.slice(0, 10)}.json"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof RecordsError) return jsonError(c, e.status as 413 | 422, e.message);
    throw e;
  }
});

/** A records file in. On the free plan it spends one of the account's yearly syncs and starts each case's 30 days again. */
app.post("/api/records/import", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  const actor = await manages(c);
  if (!actor) return jsonError(c, 403, "Only an administrator imports a business's records.");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `records:${actor.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const { body, tooLarge } = await readJson(c, MAX_RECORDS_BYTES);
  if (tooLarge) return jsonError(c, 413, "That file is too large. Export one service at a time.");
  const tenant = currentTenant();
  const plan = settings(c.env).PLAN;
  try {
    // Everything is checked before a sync is spent or anything is written.
    const bundle = parseRecords(body);
    let sync = null;
    if (plan === "free") {
      // Per account; an administrator signed in with the shared key has none, so the business is counted.
      const taken = await takeSync(c.env, c.get("account")?.sub ?? `tenant:${tenant}`);
      if (!taken.ok) return c.json({ error: `The free plan allows ${taken.limit} syncs a year, and they are used.${taken.freeAgainAt ? ` The next is free on ${taken.freeAgainAt.slice(0, 10)}.` : ""} The paid plan has no limit.`, ...taken }, 429);
      sync = taken;
    }
    const report = await importRecords(db(c.env) as unknown as D1Like, tenant, bundle, { plan });
    return c.json({ report, sync });
  } catch (e) {
    if (e instanceof RecordsError) return jsonError(c, e.status as 413 | 422, e.message);
    throw e;
  }
});
