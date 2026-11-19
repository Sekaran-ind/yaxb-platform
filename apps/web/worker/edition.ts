// One Worker for every edition (SUR-14). Each request acts in one edition: the open space's
// (its membership checked, identity.ts), else the address's (family.anjalai.cc is Family), else the
// combined site's. The edition chooses which database is read, so one edition's data is never read
// through another's: every store in kiosk.ts takes `db(env)`, and every per-isolate cache is keyed
// by the edition as well as the tenant.
import { AsyncLocalStorage } from "node:async_hooks";
import { chooseSurface, type Surface } from "@sekaran-ind/yaxb-core/context";

export type Edition = Surface;
export const EDITIONS: readonly Edition[] = ["all", "family", "business", "community"];

/** Each edition's database binding: the combined site keeps `DB` (yaxb), as before. */
export const EDITION_DB = { all: "DB", family: "DB_FAMILY", business: "DB_BUSINESS", community: "DB_COMMUNITY" } as const satisfies Record<Edition, string>;

export const editionContext = new AsyncLocalStorage<Edition>();

/** The edition this request acts in. Outside a request's edition there is no database to use. */
export function currentEdition(): Edition {
  const e = editionContext.getStore();
  if (!e) throw new Error("No edition chosen for this call (editionContext).");
  return e;
}

/** Run something in another edition (starting a space of another kind, collecting a join there). */
export const withEdition = <T>(edition: Edition, fn: () => T): T => editionContext.run(edition, fn);

/** The edition's own database. A missing binding is an error, never another edition's database. */
export function dbFor(env: Record<string, unknown>, edition: Edition): D1Database {
  const db = env[EDITION_DB[edition]] as D1Database | undefined;
  if (!db) throw new Error(`The ${edition} database isn't bound (${EDITION_DB[edition]}).`);
  return db;
}

/** This request's database. */
export const db = (env: Record<string, unknown>): D1Database => dbFor(env, currentEdition());

/** The request's edition from its open space and address; `fallback` is the SURFACE setting. */
export const editionFor = (input: { space?: string | null; host: string; fallback?: string | null }): Edition => chooseSurface(input);

/**
 * One value per (edition, tenant) per isolate. The edition is part of the key because each edition
 * has its own tenants, including its own "default".
 */
export function scoped<T>(cache: WeakMap<object, Map<string, T>>, env: object, make: () => T, tenant = ""): T {
  let byKey = cache.get(env);
  if (!byKey) cache.set(env, (byKey = new Map()));
  const key = `${currentEdition()}\u0000${tenant}`;
  let s = byKey.get(key);
  if (!s) byKey.set(key, (s = make()));
  return s;
}

/** The first edition (in `order`) where `find` succeeds; `missing` says which errors mean "not here". */
export async function firstEdition<T>(order: readonly Edition[], find: () => Promise<T>, missing: (e: unknown) => boolean): Promise<{ edition: Edition; value: T }> {
  let last: unknown;
  for (const edition of order) {
    try {
      return { edition, value: await withEdition(edition, find) };
    } catch (e) {
      if (!missing(e)) throw e;
      last = e;
    }
  }
  throw last;
}
