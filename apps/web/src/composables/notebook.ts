// The active notebook and its conversations, in the store the Storage setting picks. The first
// visit creates an empty notebook, so the kiosk always has one to add to.
import type { StorageId } from "@sekaran-ind/yaxb-core/settings";
import { computed, ref, shallowRef, watch, type Ref } from "vue";
import { logActivity } from "./account";
import { newNotebook, nowIso, storeFor, withSource, type BoxConnection, type KioskStore, type NotebookRecord, type ThreadRecord } from "@/lib/browser/store";

export function useNotebook(storage: Ref<StorageId>, activeId: Ref<string | null>, box: Ref<BoxConnection>) {
  const storeError = ref<string | null>(null);
  const store = shallowRef<KioskStore>(storeFor("session"));
  const notebooks = ref<NotebookRecord[]>([]);
  const threads = ref<ThreadRecord[]>([]);
  const error = ref<string | null>(null);
  const version = ref(0);
  const refresh = () => version.value++;

  // A Box without a connection falls back to this session's memory, and says so.
  watch(
    [storage, () => box.value.url, () => box.value.token],
    () => {
      try {
        store.value = storeFor(storage.value, box.value);
        storeError.value = null;
      } catch (e) {
        store.value = storeFor("session");
        storeError.value = (e as Error).message;
      }
    },
    { immediate: true },
  );

  watch(
    [store, version],
    async () => {
      try {
        let list = await store.value.listNotebooks();
        if (!list.length) {
          const first = newNotebook();
          await store.value.putNotebook(first);
          list = [first];
        }
        notebooks.value = list;
        if (!activeId.value || !list.some((n) => n.id === activeId.value)) activeId.value = list[0]!.id;
        error.value = null;
      } catch (e) {
        error.value = storage.value === "box" ? (e as Error).message : `Browser storage isn't available: ${(e as Error).message}`;
      }
    },
    { immediate: true },
  );

  const notebook = computed(() => notebooks.value.find((n) => n.id === activeId.value) ?? null);

  watch(
    [store, notebook, version],
    async () => {
      if (!notebook.value) return;
      threads.value = await store.value.listThreads(notebook.value.id).catch(() => []);
    },
    { immediate: true },
  );

  async function save(next: NotebookRecord) {
    await store.value.putNotebook({ ...next, updatedAt: nowIso() });
    refresh();
  }
  /** Latest copy from the store, so concurrent edits (a journey and the agent) don't overwrite each other. */
  async function latest() {
    return notebook.value ? ((await store.value.getNotebook(notebook.value.id)) ?? notebook.value) : null;
  }

  return {
    store,
    notebooks,
    notebook,
    threads,
    error: computed(() => storeError.value ?? error.value),
    refresh,
    save,
    latest,
    select: (id: string) => (activeId.value = id),
    async create(title: string) {
      const n = newNotebook(title.trim() || "Untitled notebook");
      await store.value.putNotebook(n);
      activeId.value = n.id;
      refresh();
      return n;
    },
    async remove(id: string) {
      await store.value.deleteNotebook(id);
      refresh();
    },
    async addSource(source: { title: string; mime: string; text: string; url?: string; fetchedAt?: string }) {
      const current = await latest();
      if (!current) throw new Error("No notebook is open.");
      await save(withSource(current, source));
      void logActivity("notebook.source_added", { sources: current.sources.length + 1 });
    },
    /** A website source read again (KNW-22): new text, title and time, same id and citation. */
    async refreshSource(id: string, page: { title: string; text: string; fetchedAt: string }) {
      const current = await latest();
      if (!current) return;
      await save({ ...current, sources: current.sources.map((s) => (s.id === id ? { ...s, title: page.title.slice(0, 200), text: page.text, fetchedAt: page.fetchedAt } : s)) });
    },
    async removeSource(id: string) {
      const current = await latest();
      if (!current) return;
      await save({ ...current, sources: current.sources.filter((s) => s.id !== id) });
      void logActivity("notebook.source_removed", { sources: current.sources.length - 1 });
    },
    async setMemory(memory: string) {
      const current = await latest();
      if (!current) return;
      await save({ ...current, memory });
      void logActivity("notebook.memory_updated", { via: "edit" });
    },
    async remember(note: string) {
      const current = await latest();
      if (!current) throw new Error("No notebook is open.");
      const base = current.memory.trim() || "# Notebook memory";
      const memory = base.includes("## Notes") ? `${base}\n- ${note.trim()}` : `${base}\n\n## Notes\n- ${note.trim()}`;
      await save({ ...current, memory });
      void logActivity("notebook.memory_updated", { via: "journey" });
    },
  };
}

export type NotebookApi = ReturnType<typeof useNotebook>;
