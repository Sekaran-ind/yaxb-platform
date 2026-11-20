// Routes: cases. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { type Context } from "hono";
import { settings } from "../env";
import { cases } from "../kiosk";
import { callerKey, quota } from "../limits";
import { CASE_REF, CaseError, MAX_CASE_RUN } from "@sekaran-ind/yaxb-core/cases";
import { type LibraryActor } from "@sekaran-ind/yaxb-core/library";
import { jsonError, sameOrigin, withinLimit, readJson } from "../http";
import { libraryActor } from "../actors";
import type { AppEnv } from "../app";

/**
 * Run a case action as the catalogue's actor (a member with their roles, the administrator, or a
 * visitor by their session). Changes are same origin; starting one is rate limited like a form.
 */
async function caseCall(c: Context<AppEnv>, fn: (a: LibraryActor & { level: number }, body: unknown) => Promise<unknown>, { limited = false } = {}) {
  if (c.req.method !== "GET" && !sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  // Central storage of cases is the paid plan; otherwise they live on devices and the box.
  if (settings(c.env).CASES_CENTRAL !== "on") return jsonError(c, 402, "Keeping requests in the cloud is part of the paid plan. This kiosk keeps them on its devices and box.");
  // How sure the server is of who this is (IDN-30): the account session's level; 0 without one.
  const actor = { ...(await libraryActor(c)), level: c.get("account")?.lvl ?? 0 };
  // Starting a case is limited like a form. A visitor opens cases by reference, so every call of
  // theirs counts too (like chat: a visit takes a few), and references (30^6) can't be guessed.
  if (limited && !(await withinLimit("form", c.env.FORM_LIMITER, `case:${actor.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  if (actor.guest && !(await withinLimit("chat", c.env.CHAT_LIMITER, `case:${actor.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  // A reference (30^6 of them) is a password for one request: wrong ones are counted per IP address,
  // so guessing is cut off however many sessions the guesser opens.
  const byRef = CASE_REF.test(caseKey(c));
  const who = byRef ? await callerKey(c, c.env) : null;
  const rule = { limit: settings(c.env).CASE_REF_MISSES, windowMs: 15 * 60_000 };
  if (who && !(await quota(c.env).allows(`ref:${who}`, rule))) return jsonError(c, 429, "Too many wrong references. Please wait a while and check the reference.");
  const body = c.req.method === "GET" ? null : (await readJson(c, MAX_CASE_RUN + 8192)).body;
  try {
    return c.json(await fn(actor, body));
  } catch (e) {
    if (e instanceof CaseError) {
      if (who && e.status === 404) await quota(c.env).note(`ref:${who}`);
      return jsonError(c, e.status, e.message);
    }
    throw e;
  }
}
/** A case id, or a reference as typed ("r-7kq4mx" works too). */
const caseKey = (c: Context<AppEnv>) => {
  const k = (c.req.param("id") ?? "").trim();
  return /^r-/i.test(k) ? k.toUpperCase() : k;
};
// A dependency started (DEP-1) is said by its reference only: its run is for the roles it goes to.
const spawnedRefs = <T extends { spawned?: { id: string; ref: string; service_title: string }[] }>(r: T) => ({ ...r, spawned: (r.spawned ?? []).map((x) => ({ id: x.id, ref: x.ref, service_title: x.service_title })) });
app.post("/api/cases", (c) => caseCall(c, async (a, body) => spawnedRefs(await cases(c.env).start(a, body)), { limited: true }));
app.get("/api/cases", (c) => caseCall(c, (a) => cases(c.env).list(a)));
app.get("/api/cases/:id", (c) => caseCall(c, (a) => cases(c.env).get(a, caseKey(c))));
app.post("/api/cases/:id/act", (c) => caseCall(c, async (a, body) => spawnedRefs(await cases(c.env).act(a, caseKey(c), body))));
app.post("/api/cases/:id/notes", (c) => caseCall(c, (a, body) => cases(c.env).note(a, caseKey(c), body)));
app.post("/api/cases/:id/finish", (c) => caseCall(c, async (a, body) => spawnedRefs(await cases(c.env).finish(a, caseKey(c), body))));
