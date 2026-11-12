<script setup lang="ts">
// A compiled bundle as a visitor would meet it: each service is a screen of the adaptive nav, its
// items open journeys in place, and journeys ask their questionnaires. Two more screens list every
// journey and every questionnaire, so content nobody links to yet can be tried too.
import type { Bundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { previewHandlers } from "@sekaran-ind/yaxb-journeys/bundle";
import { formProblems, type Journey, type Questionnaire, type ServiceHandler } from "@sekaran-ind/yaxb-journeys/journeys";
import type { Layout, NavMode } from "@sekaran-ind/yaxb-journeys/screens";
import { servicesFor, type ServiceItem } from "@sekaran-ind/yaxb-journeys/services";
import { computed, reactive, ref, watch } from "vue";
import AdaptiveNav, { type NavScreen } from "./AdaptiveNav.vue";
import JourneyRunner from "./JourneyRunner.vue";
import type { LanguageOption, SourceOption } from "./QuestionField.vue";
import QuestionnaireForm from "./QuestionnaireForm.vue";
import ServiceItems from "./ServiceItems.vue";

const props = defineProps<{
  bundle: Pick<Bundle, "services" | "journeys" | "questionnaires">;
  layout: Layout;
  width: number;
  mode?: NavMode;
  lockMode?: boolean;
  /** Real handlers; every other service a journey calls gets a stand-in. */
  handlers?: Record<string, ServiceHandler>;
  sources?: SourceOption[];
  languages?: LanguageOption[];
  storageKey?: string;
}>();

const JOURNEYS = "all-journeys";
const QUESTIONNAIRES = "all-questionnaires";
const screenId = (serviceId: string) => `service:${serviceId}`;

const journeyIds = computed(() => props.bundle.journeys.map((j) => j.id));
const offered = computed(() => servicesFor(props.bundle.services, { layout: props.layout, journeys: journeyIds.value }));
const screens = computed<NavScreen[]>(() => [
  ...offered.value.map((s) => ({ id: screenId(s.id), label: s.title, icon: s.icon, badge: String(s.items.length) })),
  ...(props.bundle.journeys.length ? [{ id: JOURNEYS, label: "All journeys", badge: String(props.bundle.journeys.length) }] : []),
  ...(props.bundle.questionnaires.length ? [{ id: QUESTIONNAIRES, label: "Questionnaires", badge: String(props.bundle.questionnaires.length) }] : []),
]);
const handlers = computed(() => previewHandlers(props.bundle.journeys, props.handlers));

const active = ref<string | null>(null);
/** The journey open on each screen, by id (so an edit keeps it open), and a note for other items. */
const open = reactive<Record<string, string | undefined>>({});
const notes = reactive<Record<string, string | undefined>>({});
const journeyOf = (screen: string) => props.bundle.journeys.find((j) => j.id === open[screen]) ?? null;

function openItem(screen: string, item: ServiceItem) {
  notes[screen] = undefined;
  if (item.journey) open[screen] = item.journey;
  else if (item.screen) notes[screen] = `In the kiosk, "${item.label}" opens the ${item.screen} screen.`;
  else if (item.staff) notes[screen] = `In the kiosk, "${item.label}" opens the staff section "${item.staff}".`;
}
const startJourney = (j: Journey) => (open[JOURNEYS] = j.id);

// Questionnaires on their own: answers and a check, without a journey.
const answers = reactive<Record<string, Record<string, unknown>>>({});
const checked = reactive<Record<string, string[] | undefined>>({});
const valuesOf = (q: Questionnaire) => answers[q.id] ?? {};
function check(q: Questionnaire) {
  checked[q.id] = formProblems(
    q.sections.flatMap((s) => s.fields),
    valuesOf(q),
  );
}
const sectionsOf = (q: Questionnaire) => q.sections.map((s) => ({ id: s.id, title: s.title, summary: s.summary, fields: s.fields.map((f) => f.id) }));

// A journey that no longer exists (edited away) closes.
watch(journeyIds, (ids) => {
  for (const k of Object.keys(open)) if (open[k] && !ids.includes(open[k]!)) open[k] = undefined;
});
</script>

<template>
  <div class="yj yj-preview">
    <p v-if="!screens.length" class="yj-note">Nothing to show yet. Add a service, a journey or a questionnaire.</p>
    <AdaptiveNav v-else v-model:active="active" :screens="screens" :width="width" :mode="mode" :lock-mode="lockMode" :storage-key="storageKey ?? 'journeys.preview'">
      <template v-for="s in offered" :key="s.id" #[screenId(s.id)]>
        <JourneyRunner
          v-if="journeyOf(screenId(s.id))"
          :journey="journeyOf(screenId(s.id))!"
          :services="handlers"
          :width="width"
          closable
          :sources="sources"
          :languages="languages"
          @close="open[screenId(s.id)] = undefined"
        />
        <template v-else>
          <ServiceItems :service="s" :journeys="bundle.journeys" @open="(i) => openItem(screenId(s.id), i)" />
          <p v-if="notes[screenId(s.id)]" class="yj-note yj-mt" role="status">{{ notes[screenId(s.id)] }}</p>
        </template>
      </template>

      <template #[JOURNEYS]>
        <JourneyRunner v-if="journeyOf(JOURNEYS)" :journey="journeyOf(JOURNEYS)!" :services="handlers" :width="width" closable :sources="sources" :languages="languages" @close="open[JOURNEYS] = undefined" />
        <ul v-else class="yj-items">
          <li v-for="j in bundle.journeys" :key="j.id">
            <button type="button" class="yj-item" @click="startJourney(j)">
              <span>
                <span class="yj-item-kind">Journey · {{ Object.keys(j.steps).length }} steps</span>
                <span class="yj-title yj-block">{{ j.title }}</span>
                <span v-if="j.summary" class="yj-small yj-muted yj-block">{{ j.summary }}</span>
              </span>
            </button>
          </li>
        </ul>
      </template>

      <template #[QUESTIONNAIRES]>
        <div class="yj-stack">
          <form v-for="q in bundle.questionnaires" :key="q.id" class="yj-card yj-stack" novalidate @submit.prevent="check(q)">
            <div>
              <h3 class="yj-title">{{ q.title }}</h3>
              <p v-if="q.summary" class="yj-small yj-muted">{{ q.summary }}</p>
            </div>
            <QuestionnaireForm
              :model-value="valuesOf(q)"
              :fields="q.sections.flatMap((x) => x.fields)"
              :sections="sectionsOf(q)"
              :width="width"
              :storage-key="`questionnaire.${q.id}`"
              :sources="sources"
              :languages="languages"
              @update:model-value="(v) => ((answers[q.id] = v), (checked[q.id] = undefined))"
            />
            <p v-if="checked[q.id]?.length" role="alert" class="yj-alert">{{ checked[q.id]!.join(" ") }}</p>
            <p v-else-if="checked[q.id]" role="status" class="yj-note">Every answer is valid.</p>
            <div class="yj-section-foot"><button type="submit" class="yj-btn">Check answers</button></div>
          </form>
        </div>
      </template>
    </AdaptiveNav>
  </div>
</template>
