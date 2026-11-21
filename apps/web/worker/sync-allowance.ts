// The free plan's yearly sync allowance (packages/yaxb-core quota/sync-allowance.ts): counted per
// account on the platform database (or in this isolate's memory in a local run). The paid plan has none.
// Whatever pushes a device's services and configuration to the server calls `takeSync` first.
import { createD1SyncUseStore, createMemorySyncUseStore, createSyncAllowance } from "@sekaran-ind/yaxb-core/quota/sync-allowance";
import type { D1Like } from "@sekaran-ind/yaxb-core/stores/d1";
import { settings, type Bindings } from "./env";

const allowances = new WeakMap<object, ReturnType<typeof createSyncAllowance>>();
/** The syncs allowed a year on this deployment, or null for no limit (the paid plan, or SYNC_PER_YEAR=0). */
export const syncLimit = (env: Bindings) => (settings(env).PLAN === "free" && settings(env).SYNC_PER_YEAR > 0 ? settings(env).SYNC_PER_YEAR : null);

export function syncAllowance(env: Bindings) {
  let a = allowances.get(env);
  if (!a) allowances.set(env, (a = createSyncAllowance(env.PLATFORM_DB ? createD1SyncUseStore(env.PLATFORM_DB as unknown as D1Like) : createMemorySyncUseStore(), { perYear: syncLimit(env) })));
  return a;
}

/** Count one sync for `account`; refused (ok: false) when the year's allowance is used. */
export const takeSync = (env: Bindings, account: string) => syncAllowance(env).take(account);
