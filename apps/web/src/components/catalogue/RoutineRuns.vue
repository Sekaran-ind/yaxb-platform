<script setup lang="ts">
// A published routine's runs (RTN-4), newest first, from its routine.* events: when, what set it
// off, how it ended, and each action's number, type and whether it worked. Never the words sent.
import { Loader2, RotateCcw } from "@lucide/vue";
import { ref } from "vue";
import { api } from "@/lib/api";

const props = defineProps<{ entryId: string }>();
type Run = { id: string; at: string; trigger: string; status: string; steps: { step: string; ok: boolean }[] };
const runs = ref<Run[] | null>(null);
const error = ref<string | null>(null);

async function load() {
  error.value = null;
  try {
    runs.value = (await api<{ runs: Run[] }>(`/api/routines/${props.entryId}/runs`)).runs;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
void load();
const TRIGGER: Record<string, string> = { schedule: "On time", date: "On the date", event: "An event", manual: "Run now" };
const STATUS: Record<string, [string, string]> = {
  done: ["Done", "text-success"],
  failed: ["Failed", "text-red-800"],
  skipped: ["Skipped", "text-gray-500"],
  limited: ["Over the limit", "text-red-800"],
  paused: ["Paused", "text-gray-500"],
  running: ["Running", "text-gray-500"],
};
const ACTION: Record<string, string> = { message: "message", summary: "summary", connector: "connector", record: "record" };
const stepText = (s: string) => {
  const [n, type] = s.split("-");
  return `${n}. ${ACTION[type ?? ""] ?? type}`;
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
</script>

<template>
  <section aria-label="Runs" class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm text-gray-600">The last 60 days. Each run shows its actions and whether they worked, never what was sent.</p>
      <button type="button" class="btn-ghost h-8 px-2 text-sm" @click="load"><RotateCcw class="size-4" aria-hidden="true" /> Refresh</button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <p v-else-if="!runs" class="flex items-center gap-2 text-sm text-gray-500"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Loading…</p>
    <p v-else-if="!runs.length" class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">It hasn't run yet.</p>
    <table v-else class="w-full text-left text-sm">
      <thead class="text-xs text-gray-500">
        <tr><th class="py-1 pr-3 font-medium">When</th><th class="py-1 pr-3 font-medium">Set off by</th><th class="py-1 pr-3 font-medium">Ended</th><th class="py-1 font-medium">Actions</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in runs" :key="r.id" class="border-t border-gray-200 align-top">
          <td class="py-1.5 pr-3 whitespace-nowrap text-ink">{{ when(r.at) }}</td>
          <td class="py-1.5 pr-3 text-ink">{{ TRIGGER[r.trigger] ?? r.trigger }}</td>
          <td class="py-1.5 pr-3" :class="STATUS[r.status]?.[1] ?? 'text-ink'">{{ STATUS[r.status]?.[0] ?? r.status }}</td>
          <td class="py-1.5 text-ink">
            <span v-for="s in r.steps" :key="s.step" class="mr-2 inline-block" :class="s.ok ? '' : 'text-red-800'">{{ stepText(s.step) }}{{ s.ok ? "" : " ✕" }}</span>
            <span v-if="!r.steps.length" class="text-gray-500">none</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
