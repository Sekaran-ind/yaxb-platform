// Sync v2 with the box (SYN-5..6): with Storage set to "box" and a box connected, this kiosk keeps
// its notebooks, conversations, schedules and service data on the device and syncs them with the
// box: at start, every minute, a moment after a change here, and when the network comes back.
// A clash goes on the conflict list (Preferences → Storage), where a person keeps this device's
// copy or the box's; nothing is decided for them.
import { boxRemote, createSyncEngine, type SyncConflict, type SyncEngine } from "@sekaran-ind/yaxb-core/sync";
import { createBoxClient } from "@sekaran-ind/yaxb-core/stores/box";
import { ref, shallowRef, watch } from "vue";
import { boxMirror, type NotebookRecord, type ThreadRecord } from "@/lib/browser/store";
import { browserShadows } from "@/lib/browser/sync-shadows";
import { setSyncHook } from "@/lib/browser/sync-hook";
import { applyScheduleRow } from "@/composables/schedule";
import { applyServiceData } from "@/composables/library";
import { settings } from "@/composables/settings";

export const syncState = ref<{ on: boolean; syncing: boolean; lastSync: string | null; error: string | null; pulled: number }>({ on: false, syncing: false, lastSync: null, error: null, pulled: 0 });
export const syncConflicts = shallowRef<SyncConflict[]>([]);
/** Bumped when rows arrive from the box, so open lists (the notebooks) read again. */
export const syncPulls = ref(0);

let engine: SyncEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function run() {
  if (!engine || syncState.value.syncing) return;
  syncState.value = { ...syncState.value, syncing: true };
  try {
    const r = await engine.sync();
    syncConflicts.value = await engine.conflicts();
    if (r.pulled) syncPulls.value++;
    syncState.value = { ...syncState.value, syncing: false, lastSync: new Date().toISOString(), error: null, pulled: syncState.value.pulled + r.pulled };
  } catch (e) {
    // Offline or the box is down: changes stay here, marked to send.
    syncState.value = { ...syncState.value, syncing: false, error: (e as Error).message };
  }
}
const runSoon = () => {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => void run(), 1500);
};

async function build() {
  if (timer) clearInterval(timer);
  timer = null;
  engine = null;
  setSyncHook(null);
  const box = settings.box;
  const mirror = boxMirror();
  if (settings.agent.storage !== "box" || !box.url || !box.token || !mirror) {
    syncState.value = { ...syncState.value, on: false, error: null };
    return;
  }
  let client;
  try {
    client = createBoxClient(box);
  } catch (e) {
    syncState.value = { ...syncState.value, on: false, error: (e as Error).message };
    return;
  }
  const e = createSyncEngine({
    remote: boxRemote(client),
    shadows: await browserShadows(),
    adapters: {
      notebooks: { apply: async (id, data) => (data ? mirror.putNotebook(data as NotebookRecord) : mirror.deleteNotebook(id)) },
      threads: { apply: async (id, data) => (data ? mirror.putThread(data as ThreadRecord) : mirror.deleteThread(id)) },
      schedule: { apply: applyScheduleRow },
      "service-data": { apply: async (id, data) => applyServiceData(id, data) },
    },
  });
  engine = e;
  setSyncHook((collection, id, data) => void e.track(collection, id, data).then(runSoon));
  syncState.value = { ...syncState.value, on: true };
  timer = setInterval(() => void run(), 60_000);
  void run();
}

/** Start following the storage setting (once, from App.vue). */
export function startSync() {
  if (started) return;
  started = true;
  watch([() => settings.agent.storage, () => settings.box.url, () => settings.box.token], () => void build(), { immediate: true });
  if (typeof window !== "undefined") window.addEventListener("online", () => void run());
}

export const syncNow = () => run();

/** Settle a conflict: keep this device's copy (written over the box's) or the box's. */
export async function resolveConflict(key: string, choice: "mine" | "theirs") {
  if (!engine) return;
  await engine.resolve(key, choice);
  syncConflicts.value = await engine.conflicts();
  syncPulls.value++;
}

/** A conflict in words a person can decide on: what it is, and when each side changed it. */
export function conflictLabel(c: SyncConflict): { title: string; kind: string } {
  const data = (c.mine ?? c.theirs?.data ?? {}) as { title?: string };
  const kind = c.collection === "notebooks" ? "Notebook" : c.collection === "threads" ? "Conversation" : c.collection === "schedule" ? "Scheduler entry" : "Services on the kiosk";
  return { title: (typeof data.title === "string" && data.title) || kind, kind };
}
