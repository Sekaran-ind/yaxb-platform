<script setup lang="ts">
// A service's audit trail (LIB-17): who created, saved, submitted, reviewed and archived it, when.
// Facts only, never the content.
import { AUDIT_ACTIONS, type AuditEvent } from "@sekaran-ind/yaxb-core/moderators";
import { RefreshCw } from "@lucide/vue";
import { ref, watch } from "vue";
import { api } from "@/lib/api";

const props = defineProps<{ entryId: string }>();
const events = ref<AuditEvent[] | null>(null);
const error = ref<string | null>(null);
async function load() {
  error.value = null;
  try {
    events.value = (await api<{ events: AuditEvent[] }>(`/api/library/entries/${props.entryId}/audit`)).events;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(() => props.entryId, load, { immediate: true });
const who = (e: AuditEvent) => (e.actor_type === "guest" ? `${e.actor_name ?? "Guest"} (no sign-in)` : e.actor_type === "admin" ? "Administrator" : (e.actor_name ?? "Someone"));
const facts = (e: AuditEvent) =>
  Object.entries(e.details ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
</script>

<template>
  <section class="space-y-3" aria-label="Audit">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm text-gray-600">Everything that happened to this service. The log keeps facts only, never the questions or answers.</p>
      <button type="button" class="btn-ghost h-8 px-2" aria-label="Refresh" @click="load"><RefreshCw class="size-4" aria-hidden="true" /></button>
    </div>
    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-else-if="events && !events.length" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-600">Nothing recorded yet.</p>
    <div v-else-if="events" class="overflow-x-auto rounded-xl ring-1 ring-gray-100">
      <table class="w-full text-left text-sm">
        <thead class="bg-mist text-xs text-gray-500">
          <tr>
            <th scope="col" class="px-3 py-2 font-medium">When</th>
            <th scope="col" class="px-3 py-2 font-medium">Who</th>
            <th scope="col" class="px-3 py-2 font-medium">What</th>
            <th scope="col" class="px-3 py-2 font-medium">Details</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="e in events" :key="e.id">
            <td class="px-3 py-2 whitespace-nowrap text-gray-600">{{ new Date(e.at).toLocaleString() }}</td>
            <td class="px-3 py-2 text-ink">{{ who(e) }}</td>
            <td class="px-3 py-2 text-ink">{{ AUDIT_ACTIONS[e.action] ?? e.action }}</td>
            <td class="px-3 py-2 text-xs text-gray-500">{{ facts(e) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
