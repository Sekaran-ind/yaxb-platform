import { ref } from "vue";

/** GET a read-only kiosk resource from /api/agent/<name>, with refresh. */
export function useAgentResource<T>(name: "sources" | "curated" | "moderation") {
  const data = ref<T | null>(null);
  const error = ref<string | null>(null);
  async function refresh() {
    try {
      const r = await fetch(`/api/agent/${name}`);
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "Unavailable");
      data.value = (await r.json()) as never;
      error.value = null;
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  void refresh();
  return { data, error, refresh };
}
