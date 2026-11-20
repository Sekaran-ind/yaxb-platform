// Shared by several route modules: who is acting (administrator, member, catalogue actor) and the
// helpers they all use.
import { type Context } from "hono";
import { z } from "zod";
import { type SiteUse } from "@sekaran-ind/yaxb-core/sites";
import { sites } from "./kiosk";
import { catalogue, currentTenant, moderators, tenants } from "./kiosk";
import { DEFAULT_TENANT, TenantError } from "@sekaran-ind/yaxb-core/tenants";
import { offers, resolveContext } from "@sekaran-ind/yaxb-core/context";
import { currentEdition, EDITIONS, firstEdition } from "./edition";
import { DesignerError } from "@sekaran-ind/yaxb-core/designer";
import { ADMIN_ACTOR_ID, LibraryError, MAX_ENTRY_BYTES, type LibraryActor } from "@sekaran-ind/yaxb-core/library";
import { auditEvent } from "@sekaran-ind/yaxb-core/moderators";
import { clientId, isAdmin, moderatorOf } from "./session";
import { jsonError, withinLimit, readJson } from "./http";
import type { AppEnv } from "./app";

export const signInSchema = z.strictObject({ token: z.string().min(1).max(256) });
/** Where this request stands for the approved list: its edition, its business (none for a family) and region. */
export const siteScope = (c: Context<AppEnv>) => {
  const edition = currentEdition();
  const family = edition === "family" || c.get("space")?.kind === "family";
  return { edition, tenant: family ? null : currentTenant(), family, region: "IN" };
};
export const siteHere = (c: Context<AppEnv>, url: string, use: SiteUse) => sites(c.env).verdict(url, use, siteScope(c));
/** Ask for a site: in the business's name, or "a family"; the asker kept only so they can't approve it. */
export async function askForSite(c: Context<AppEnv>, url: string, use: SiteUse, reason?: string) {
  const scope = siteScope(c);
  const label = scope.family ? "a family" : ((await tenants(c.env).tenant(currentTenant()).catch(() => null))?.name ?? (currentTenant() === DEFAULT_TENANT ? "this kiosk's business" : "a business"));
  const askedBy = c.get("account")?.sub ?? `session:${await clientId(c)}`;
  return sites(c.env).request({ url, use, reason, askedByLabel: label, askedBy, edition: scope.edition, tenant: scope.tenant });
}
/** The administrator: the ADMIN_TOKEN holder, or a member with the administrator role (TEAM-1). */
export async function administrator(c: Context<AppEnv>): Promise<{ name: string } | null> {
  if (await isAdmin(c)) return { name: "Administrator" };
  const m = await memberOf(c);
  return m?.roles.includes("administrator") ? { name: m.name } : null;
}

// ---- the directory, businesses and join links (TEN-1..8) --------------------------------------------------

export const tenantError = (c: Context<AppEnv>, e: unknown) => {
  if (e instanceof TenantError) return jsonError(c, e.status, e.message);
  throw e;
};
export const audited = (c: Context<AppEnv>, action: Parameters<typeof auditEvent>[0]["action"], name: string | null, target: string | null, details?: Record<string, unknown>) =>
  moderators(c.env).store.audit(auditEvent({ actor_type: "moderator", actor_id: null, actor_name: name, action, target_id: target, ...(details ? { details } : {}) }));

/**
 * Join links and requests live in the edition that issued them; one address serves every edition, so
 * they are looked up in this request's edition first, then the others that offer joining. "Not
 * found" in one edition means "try the next"; any other refusal is the answer.
 */
export function joinEdition<T>(find: () => Promise<T>) {
  const here = currentEdition();
  const order = [here, ...EDITIONS.filter((e) => e !== here)].filter((e) => offers(resolveContext({ surface: e }), "join"));
  if (!order.length) throw new TenantError("That join link isn't valid.", 404);
  return firstEdition(order, find, (e) => e instanceof TenantError && e.status === 404);
}

/**
 * Who acts on the catalogue: the ADMIN_TOKEN holder, a signed-in member with their roles, or a
 * guest (anyone else), known by their session, who may design services and change only their own.
 */
export async function libraryActor(c: Context<AppEnv>): Promise<LibraryActor> {
  if (await isAdmin(c)) return { id: ADMIN_ACTOR_ID, name: "Administrator", roles: ["administrator"], admin: true };
  const who = await moderatorOf(c, moderators(c.env));
  if (who) return { id: who.id, name: who.name, roles: who.roles, admin: false };
  return { id: `guest:${await clientId(c)}`, name: "Guest", roles: [], admin: false, guest: true };
}

/** Run a catalogue action, turning its refusals into JSON errors. Guests' creating and submitting are rate limited. */
export async function libraryCall(c: Context<AppEnv>, fn: (a: LibraryActor, body: unknown) => Promise<unknown>, { limited = false } = {}) {
  await catalogue(c.env);
  const actor = await libraryActor(c);
  if (limited && actor.guest && !(await withinLimit("form", c.env.FORM_LIMITER, `catalogue:${actor.id}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const body = c.req.method === "GET" || c.req.method === "DELETE" ? null : (await readJson(c, MAX_ENTRY_BYTES * 2 + 4096)).body;
  try {
    return c.json((await fn(actor, body)) ?? { ok: true });
  } catch (e) {
    if (e instanceof LibraryError || e instanceof DesignerError) return jsonError(c, e.status, e.message);
    throw e;
  }
}

/** A member: signed in with their own key (the shared token has no identity to call or message). */
export async function memberOf(c: Context<AppEnv>) {
  const who = await moderatorOf(c, moderators(c.env));
  return who?.moderator ? who.moderator : null;
}
