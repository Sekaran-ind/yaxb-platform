// Where local writes are reported for sync v2 (SYN-5): the notebook store (Storage: box), the
// Scheduler and the kiosk's loaded services call trackWrite(); composables/sync.ts sets the hook
// when this kiosk syncs with a box, and nothing happens otherwise. Rows pulled from the box are
// written without it (the adapters), so they don't bounce back.
import type { SyncCollection } from "@sekaran-ind/yaxb-core/sync";

let hook: ((collection: SyncCollection, id: string, data: unknown | null) => void) | null = null;

export const setSyncHook = (fn: typeof hook) => void (hook = fn);
/** A row changed on this device (null: deleted). */
export const trackWrite = (collection: SyncCollection, id: string, data: unknown | null) => hook?.(collection, id, data === null ? null : JSON.parse(JSON.stringify(data)));
