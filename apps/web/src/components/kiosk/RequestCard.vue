<script setup lang="ts">
// A request in the conversation (LIB-52): its reference, kept with the conversation, and where it is
// now, looked up whenever the conversation is open. A request handed over from a journey here, or a
// reference typed into the conversation, shows like this. Opening it unfolds the whole request here
// (its answers, its thread, carrying on), so the conversation never sends anyone to another tab.
import type { CaseSummary } from "@sekaran-ind/yaxb-core/cases";
import { ChevronRight, Inbox, Loader2, RotateCcw } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import CaseView from "./CaseView.vue";
import RequestStatus from "./RequestStatus.vue";
import type { NotebookRecord } from "@/lib/browser/store";
import { deliveryText, openCase, statusText, type CaseDetail } from "@/composables/cases";
import { roleName } from "@/composables/library";

const props = defineProps<{ reference: string; services: Record<string, ServiceHandler>; notebook: NotebookRecord | null; open?: boolean }>();
/** The whole request, unfolded in the conversation. */
const unfolded = ref(Boolean(props.open));
const detail = ref<CaseDetail | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    detail.value = await openCase(props.reference);
  } catch (e) {
    detail.value = null;
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const c = computed<CaseSummary | null>(() => detail.value?.case ?? null);
const step = computed(() => (c.value?.waiting_step ? (detail.value!.case.journey.steps[c.value.waiting_step]?.label ?? "") : ""));
const delivery = computed(() => detail.value?.deliveries?.[0] ?? null);
function fold() {
  unfolded.value = false;
  void load();
}
</script>

<template>
  <div v-if="unfolded" class="card p-4">
    <CaseView :case-key="reference" :services="services" :notebook="notebook" embedded @back="fold" />
  </div>
  <div v-else class="card space-y-2 p-4" role="group" :aria-label="`Request ${reference}`">
    <div class="flex flex-wrap items-center gap-2">
      <Inbox class="size-4 text-brand" aria-hidden="true" />
      <span class="font-mono text-sm font-semibold tracking-wider text-ink">{{ reference }}</span>
      <RequestStatus v-if="c" :status="c.status" />
      <button type="button" class="btn-ghost ml-auto h-8 px-2 text-xs" :disabled="loading" aria-label="Check its status again" @click="load">
        <Loader2 v-if="loading" class="size-3.5 animate-spin" aria-hidden="true" /><RotateCcw v-else class="size-3.5" aria-hidden="true" /> Refresh
      </button>
    </div>
    <template v-if="c">
      <p class="text-sm font-medium text-ink">{{ c.journey_title }}</p>
      <p class="text-sm text-gray-700">
        {{ detail!.turn ? (c.status === "to_finish" ? "It is yours to close." : `It is your turn${step ? `: ${step}` : ""}.`) : statusText(c, roleName) + (step && c.status === "waiting" ? `: ${step}` : "") }}
      </p>
      <p v-if="c.result && (c.status === 'done' || c.status === 'to_finish')" class="text-sm text-ink">{{ c.result.title }}</p>
      <p v-if="delivery && c.status !== 'done' && c.status !== 'declined'" class="text-xs text-gray-500">{{ deliveryText(delivery) }}</p>
      <button type="button" class="btn-light h-10 px-3 text-sm" @click="unfolded = true">{{ detail!.turn ? "Carry on" : "Open the request" }} <ChevronRight class="size-4" aria-hidden="true" /></button>
    </template>
    <p v-else-if="error" class="text-sm text-gray-700">
      {{ error }} A request handed over on another kiosk can be checked there, or with the person who has it now.
    </p>
    <p v-else class="flex items-center gap-2 text-sm text-gray-600"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Checking…</p>
  </div>
</template>
