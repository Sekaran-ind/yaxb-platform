<script setup lang="ts">
// A routine's dry run (RTN-3): the server runs its YAML (saved or not) with stand-ins, so nothing
// is sent, called or recorded, and shows what each action would have done, with its words. The
// summary is read for real, since reading changes nothing. An event routine gets a made-up event.
import type { RoutineRun } from "@sekaran-ind/yaxb-core/routines";
import { CheckCircle2, FlaskConical, Loader2, XCircle } from "@lucide/vue";
import { ref, watch } from "vue";
import { api } from "@/lib/api";

const props = defineProps<{ yaml: string; problems: string[] }>();
const run = ref<RoutineRun | null>(null);
const refused = ref<string[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
// A changed routine needs a new dry run.
watch(() => props.yaml, () => (run.value = null));

async function tryIt() {
  busy.value = true;
  error.value = null;
  refused.value = [];
  try {
    const out = await api<{ ok: boolean; run?: RoutineRun; problems?: string[] }>("/api/routines/dry-run", { yaml: props.yaml });
    run.value = out.run ?? null;
    refused.value = out.problems ?? [];
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const ENDED: Record<string, string> = { done: "It would run every action.", failed: "It would stop at a failing action.", skipped: "Its condition doesn't hold now, so it would do nothing." };
</script>

<template>
  <section aria-label="Dry run" class="space-y-3">
    <p class="text-sm text-gray-600">A dry run sends nothing, calls nothing and records nothing. It shows what the routine would do now, with the words it would send.</p>
    <p v-if="props.problems.length" class="caution">Fix the routine first: {{ props.problems.join(" ") }}</p>
    <button type="button" class="btn-primary" :disabled="busy || props.problems.length > 0" @click="tryIt">
      <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><FlaskConical v-else class="size-4" aria-hidden="true" /> Try a dry run
    </button>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <ul v-if="refused.length" class="list-disc pl-5 text-sm text-red-800">
      <li v-for="p in refused" :key="p">{{ p }}</li>
    </ul>
    <div v-if="run" class="space-y-2 rounded-xl bg-mist p-4" role="status">
      <p class="text-sm font-semibold text-ink">{{ ENDED[run.status] ?? run.reason ?? run.status }}</p>
      <ol class="space-y-1.5">
        <li v-for="(line, i) in run.preview ?? []" :key="i" class="flex items-start gap-2 text-sm">
          <CheckCircle2 v-if="run.steps[i]?.ok" class="mt-0.5 size-4 shrink-0 text-success" aria-label="Would work" />
          <XCircle v-else-if="run.steps[i]" class="mt-0.5 size-4 shrink-0 text-red-800" aria-label="Would fail" />
          <span v-else class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span class="text-ink">
            {{ line }}
            <span v-if="run.steps[i] && !run.steps[i]!.ok" class="block text-red-800">{{ run.steps[i]!.note }}</span>
          </span>
        </li>
      </ol>
    </div>
  </section>
</template>
