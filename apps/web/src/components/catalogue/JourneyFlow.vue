<script setup lang="ts">
// The Flow view of a service (JRN-43..44): each journey's state machine as a diagram, what the
// design checks say about it, and one way through to each ending, so a designer sees what the
// journey really does (a result that ends it early, an approval nobody is asked for) before review.
import type { Bundle, BundleProblem } from "@sekaran-ind/yaxb-journeys";
import { waysThrough } from "@sekaran-ind/yaxb-journeys";
import { FlowDiagram } from "@sekaran-ind/yaxb-journeys/vue";
import { AlertTriangle, CheckCircle2, GitBranch } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import SegmentedControl from "@/components/site/SegmentedControl.vue";

const props = defineProps<{ bundle: Bundle; problems: readonly BundleProblem[] }>();
const emit = defineEmits<{ line: [line: number] }>();

const journeys = computed(() => props.bundle.journeys);
const chosen = ref<string>("");
watch(journeys, (js) => (!js.some((j) => j.id === chosen.value) ? (chosen.value = js[0]?.id ?? "") : null), { immediate: true });
const journey = computed(() => journeys.value.find((j) => j.id === chosen.value) ?? null);
const notes = computed(() => props.problems.filter((p) => p.kind === "journey" && p.id === chosen.value));
const ways = computed(() => (journey.value ? waysThrough(journey.value) : []));
const label = (id: string) => (id === "(failed)" ? "Failed" : (journey.value?.steps[id]?.label ?? id));
</script>

<template>
  <section class="space-y-4" aria-labelledby="flow-title">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h3 id="flow-title" class="flex items-center gap-2 text-base font-semibold text-ink"><GitBranch class="size-4 text-brand" aria-hidden="true" /> Flow</h3>
        <p class="text-sm text-gray-600">Each journey as a state machine: every screen, every way out, and what can't be reached.</p>
      </div>
      <SegmentedControl v-if="journeys.length > 1" v-model="chosen" :options="journeys.map((j) => ({ value: j.id, label: j.title }))" label="Journey" />
    </div>
    <p v-if="!journey" class="rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">No journey compiles yet: fix the problems in YAML first.</p>
    <template v-else>
      <ul v-if="notes.length" class="space-y-1.5">
        <li v-for="(n, i) in notes" :key="i">
          <button type="button" :class="['flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-sm', n.level === 'error' ? 'bg-red-50 text-red-800' : 'caution']" @click="emit('line', n.line)">
            <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{{ n.message }} <span class="text-xs opacity-75">(line {{ n.line }})</span></span>
          </button>
        </li>
      </ul>
      <p v-else class="flex items-center gap-2 rounded-xl bg-mist px-3 py-2 text-sm text-body"><CheckCircle2 class="size-4 text-brand" aria-hidden="true" /> Every screen is reached and every way through ends.</p>

      <div class="rounded-2xl bg-canvas p-3 ring-1 ring-gray-200">
        <FlowDiagram :journey="journey" :roles="bundle.roles" />
      </div>

      <div>
        <h4 class="eyebrow mb-2">Ways through</h4>
        <ol class="space-y-1.5">
          <li v-for="w in ways" :key="w.end" class="rounded-xl bg-mist px-3 py-2 text-sm text-body">
            <span class="font-medium text-ink">{{ label(w.end) }}:</span>
            <template v-for="(s, i) in w.steps" :key="`${s}-${i}`"><template v-if="i"> → <span v-if="w.via[i - 1]" class="text-xs text-gray-500">({{ w.via[i - 1] }}) </span></template>{{ label(s) }}</template>
          </li>
        </ol>
      </div>
    </template>
  </section>
</template>
