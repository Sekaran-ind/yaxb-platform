// The Scheduler (SCH-1..8): each person's calendar (to-dos, birthdays, anniversaries, events), kept
// on this device with their profile (IndexedDB `yaxb-schedule`, or memory), beside the dates of the
// services this kiosk offers. The Scheduler agent reads a sentence into an entry to confirm: on the
// device first, then the AI model (when there is one) fills in what the device couldn't tell.
import { parseScheduleText, draftFromFills, SCHEDULE_FORM, type ScheduleDraft, type ScheduleItem, type ServiceDate, upcoming, isoDay } from "@sekaran-ind/yaxb-core/schedule";
import { parseDocument, serviceDates } from "@sekaran-ind/yaxb-journeys";
import { computed, ref, shallowRef } from "vue";
import { useAccount } from "@/composables/account";
import { loadedServices } from "@/composables/library";
import { effectiveSelection, settings } from "@/composables/settings";
import { extractWithModel } from "@/lib/browser/slots";
import type { ProvidersResponse } from "@/lib/types";

const DB = "yaxb-schedule";
let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, ScheduleItem>();
function db(): Promise<IDBDatabase | null> {
  return (dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("items", { keyPath: "id" }).createIndex("owner", "owner");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}
async function all(): Promise<ScheduleItem[]> {
  const d = await db();
  if (!d) return [...memory.values()];
  return new Promise((resolve) => {
    const req = d.transaction("items").objectStore("items").getAll();
    req.onsuccess = () => resolve(req.result as ScheduleItem[]);
    req.onerror = () => resolve([]);
  });
}
async function put(item: ScheduleItem) {
  const d = await db();
  if (!d) return void memory.set(item.id, { ...item });
  await new Promise<void>((resolve) => {
    const tx = d.transaction("items", "readwrite");
    tx.objectStore("items").put({ ...item });
    tx.oncomplete = tx.onerror = () => resolve();
  });
}
async function remove(id: string) {
  const d = await db();
  if (!d) return void memory.delete(id);
  await new Promise<void>((resolve) => {
    const tx = d.transaction("items", "readwrite");
    tx.objectStore("items").delete(id);
    tx.oncomplete = tx.onerror = () => resolve();
  });
}

const items = shallowRef<ScheduleItem[]>([]);
const loaded = ref(false);
/** Words for the Scheduler to read when it opens (from `/schedule <words>` in Ask Me). */
export const pendingScheduleText = ref("");

export function useSchedule() {
  const account = useAccount();
  /** This person's: the open profile's, or (no profile) this device's. */
  const owner = computed(() => account.profileId.value);
  const mine = computed(() => items.value.filter((i) => (i.owner ?? null) === owner.value));
  const refresh = async () => {
    items.value = await all();
    loaded.value = true;
  };
  if (!loaded.value) void refresh();

  /** The dates of the services this kiosk offers, read from their published definitions. */
  const services = computed(() =>
    loadedServices.value.flatMap((s) => {
      const p = parseDocument(s.meta.yaml);
      const dates: ServiceDate[] = p.ok ? serviceDates(p.doc.dates) : [];
      return dates.length ? [{ entry: s.meta.entry_id, title: s.meta.title, dates }] : [];
    }),
  );
  const today = () => isoDay(new Date());

  return {
    items: mine,
    services,
    today,
    upcoming: (days = 30) => upcoming(mine.value, today(), days, services.value),
    async save(draft: ScheduleDraft & { notes?: string | null; id?: string; done?: boolean }) {
      const at = new Date().toISOString();
      const existing = draft.id ? items.value.find((i) => i.id === draft.id) : undefined;
      const item: ScheduleItem = {
        id: existing?.id ?? crypto.randomUUID(),
        owner: existing ? existing.owner : owner.value,
        kind: draft.kind,
        title: draft.title.trim().slice(0, 120),
        date: draft.date,
        time: draft.time,
        repeat: draft.repeat,
        done: draft.done ?? existing?.done ?? false,
        person: draft.person,
        notes: draft.notes ?? existing?.notes ?? null,
        created_at: existing?.created_at ?? at,
        updated_at: at,
      };
      await put(item);
      await refresh();
      return item;
    },
    async toggleDone(id: string) {
      const it = items.value.find((i) => i.id === id);
      if (!it) return;
      await put({ ...it, done: !it.done, updated_at: new Date().toISOString() });
      await refresh();
    },
    async remove(id: string) {
      await remove(id);
      await refresh();
    },
    /**
     * The Scheduler agent: a sentence into an entry to confirm. The device reads it first; when it
     * can't tell the day (or the title), the AI model fills the Scheduler's form, if there is one.
     */
    async draft(text: string, catalog: ProvidersResponse | null): Promise<{ draft: ScheduleDraft; via: "device" | "assistant" }> {
      const base = parseScheduleText(text, new Date());
      const selection = effectiveSelection(settings, catalog);
      if ((base.date && base.title) || !selection) return { draft: base, via: "device" };
      try {
        const fills = await extractWithModel(SCHEDULE_FORM.journey, SCHEDULE_FORM.step, text, selection);
        return { draft: draftFromFills(base, fills), via: "assistant" };
      } catch {
        return { draft: base, via: "device" };
      }
    },
  };
}
