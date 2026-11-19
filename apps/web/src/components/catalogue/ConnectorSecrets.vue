<script setup lang="ts">
// A connector's secrets (CNX-3), for administrators: the names its YAML asks for, whether each is set,
// and a box to set or replace one. A value goes to the server, sealed there, and is never shown again:
// not here, not to a kiosk, not to a journey.
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { KeyRound } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { api } from "@/lib/api";

const props = defineProps<{ connector: string; needed: string[] }>();
const set = ref<{ name: string; set_at: string; set_by: string | null }[]>([]);
const value = ref<Record<string, string>>({});
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
async function load() {
  try {
    set.value = (await api<{ set: typeof set.value }>(`/api/library/connectors/${encodeURIComponent(props.connector)}/secrets`)).set;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
const when = (n: string) => set.value.find((s) => s.name === n);
async function save(name: string) {
  busy.value = true;
  error.value = notice.value = null;
  try {
    await api(`/api/library/connectors/${encodeURIComponent(props.connector)}/secrets/${name}`, { value: value.value[name] ?? "" }, "PUT");
    value.value = { ...value.value, [name]: "" };
    notice.value = `${name} is set. It stays on the server.`;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function remove(name: string) {
  await api(`/api/library/connectors/${encodeURIComponent(props.connector)}/secrets/${name}`, undefined, "DELETE").catch((e: Error) => (error.value = e.message));
  await load();
}
</script>

<template>
  <section class="card space-y-3 p-4" aria-labelledby="secrets-h">
    <h3 id="secrets-h" class="flex items-center gap-2 font-semibold text-ink"><KeyRound class="size-5 text-brand" aria-hidden="true" /> Secrets</h3>
    <p class="text-sm text-gray-600">The connector's YAML names its secrets; their values are set here, sealed on the server, and never shown again or sent to a kiosk. The connector works once it is published and its secrets are set.</p>
    <p v-if="!needed.length" class="text-sm text-gray-600">This connector needs no secret.</p>
    <form v-for="n in needed" :key="n" class="flex flex-wrap items-end gap-2 rounded-lg bg-mist p-3" @submit.prevent="save(n)">
      <label class="block min-w-0 flex-1 text-sm">
        <span class="mb-1 block font-medium text-ink"><code>{{ n }}</code> <span class="font-normal text-gray-500">{{ when(n) ? `set ${new Date(when(n)!.set_at).toLocaleDateString()}${when(n)!.set_by ? ` by ${when(n)!.set_by}` : ""}` : "not set" }}</span></span>
        <input v-model="value[n]" class="input" type="password" autocomplete="off" :placeholder="when(n) ? 'Type a new value to replace it' : 'The value from the service'" />
      </label>
      <button type="submit" class="btn-primary h-10" :disabled="busy || !value[n]">{{ when(n) ? "Replace" : "Set" }}</button>
      <ConfirmAction v-if="when(n)" label="Remove" :message="`Remove ${n}? The connector stops working until it is set again.`" trigger-class="btn-ghost h-10" @confirm="remove(n)" />
    </form>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-ink">{{ notice }}</p>
  </section>
</template>
