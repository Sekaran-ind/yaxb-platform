<script setup lang="ts">
// A journey in the conversation (LIB-49): started from /journeys or /staff (or a Services item), it
// runs here and is kept with the conversation, so opening the conversation again carries on where it
// stopped. Once handed over, it is its request: the reference and where it is now.
import type { CaseSummary } from "@sekaran-ind/yaxb-core/cases";
import type { RunSnapshot, RunState, ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import { CheckCircle2, RotateCcw } from "@lucide/vue";
import { computed, ref } from "vue";
import JourneyPanel from "./JourneyPanel.vue";
import RequestCard from "./RequestCard.vue";
import { kioskJourneys } from "@/composables/library";
import type { NotebookRecord } from "@/lib/browser/store";
import type { JourneyTurn } from "@/lib/types";

const props = defineProps<{ turn: JourneyTurn; services: Record<string, ServiceHandler>; notebook: NotebookRecord | null; order?: number }>();
const emit = defineEmits<{ update: [patch: Partial<JourneyTurn>]; speak: [text: string]; done: [journeyId: string] }>();

const journey = computed(() => kioskJourneys.value.find((j) => j.id === props.turn.id) ?? null);
/** Shown live while it runs in this visit; a journey handed over earlier shows as its request. */
const live = ref(props.turn.status === "running" || props.turn.status === "done");
const run = ref(0);
/** Finished before this visit: opening the conversation again does not count it twice. */
const wasDone = props.turn.status === "done";

function onProgress(snap: RunSnapshot, status: RunState["status"], result: RunState["result"]) {
  if (props.turn.status === "handed") return;
  emit("update", { run: snap, status: status === "done" ? "done" : "running", result: status === "done" && result ? { title: result.title, text: result.text } : null });
}
function onHanded(c: CaseSummary) {
  emit("update", { status: "handed", handed: { ref: c.ref, caseId: c.id } });
}
function again() {
  emit("update", { run: null, status: "running", handed: undefined, result: null });
  live.value = true;
  run.value++;
}
</script>

<template>
  <div class="space-y-3">
    <template v-if="live && journey">
      <JourneyPanel
        :key="run"
        embedded
        :journey="journey"
        :entry="turn.entry"
        :initial="turn.run"
        :form-order="order"
        :services="services"
        :notebook="notebook"
        @progress="onProgress"
        @handed="onHanded"
        @close="(live = false), emit('update', { status: turn.status === 'handed' ? 'handed' : 'closed' })"
        @done="!wasDone && emit('done', turn.id)"
        @speak="(t) => emit('speak', t)"
      />
    </template>
    <RequestCard v-else-if="turn.handed" :reference="turn.handed.ref" :services="services" :notebook="notebook" />
    <!-- Folded away with Done: what it came to, and a way to run it again. -->
    <div v-else class="card space-y-2 p-4 text-sm" role="group" :aria-label="turn.title">
      <div class="flex flex-wrap items-center gap-3">
        <CheckCircle2 v-if="journey" class="size-4 shrink-0 text-success" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <template v-if="!journey"><span class="text-ink">“{{ turn.title }}” isn't on this kiosk now: its service was removed.</span></template>
          <template v-else>
            <span class="block font-medium text-ink">{{ turn.title }}</span>
            <span class="block text-xs text-gray-500">{{ turn.result ? `Finished: ${turn.result.title}` : "Finished" }}</span>
          </template>
        </span>
        <button v-if="journey" type="button" class="btn-light h-10 px-3" @click="again"><RotateCcw class="size-4" aria-hidden="true" /> Start again</button>
      </div>
      <details v-if="turn.result?.text" class="rounded-lg bg-mist px-3 py-2">
        <summary class="cursor-pointer font-medium text-ink">Read the result</summary>
        <p class="mt-2 leading-relaxed whitespace-pre-wrap text-ink">{{ turn.result.text }}</p>
      </details>
    </div>
  </div>
</template>
