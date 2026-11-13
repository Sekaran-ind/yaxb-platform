<script setup lang="ts">
// Design a whole service in four steps, with Previous / Next named after the neighbouring steps:
//   1 Service   its name and what it is for
//   2 Roles     who delivers it, and who starts and finishes each journey
//   3 Journeys  list, add, reorder and remove journeys, and edit the chosen one (its details, its
//               screens and their questions) in the same place: master/detail when there is room;
//               narrow, the list, then into one journey and back ("← Journeys")
//   4 Review    the compiled service: what to fix, and the summary; the host's `finish` slot
//               (props: ok, errors) offers the real next action, e.g. "Create service"
// The live preview (FlowPreview of the compiled design) sits beside the steps when there is room, or
// takes their place while it is on when there isn't. Bind with v-model to a ServiceDesign (forms.ts);
// designToDoc and toYaml give the nested YAML (nested.ts).
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { designToDoc, idFromName, newJourneyDesign, toYaml, type JourneyDesign, type ServiceDesign } from "@sekaran-ind/yaxb-journeys/forms";
import { roleLabel, type Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { resolveLayout } from "@sekaran-ind/yaxb-journeys/screens";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import ConfirmAction from "./ConfirmAction.vue";
import FlowPreview from "./FlowPreview.vue";
import Glyph from "./Glyph.vue";
import JourneyDesigner from "./JourneyDesigner.vue";
import RolesPanel from "./RolesPanel.vue";
import ServiceSummary from "./ServiceSummary.vue";

const props = defineProps<{ modelValue: ServiceDesign; serviceNames?: readonly string[]; readonly?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [design: ServiceDesign]; /** Whether the last step (Review) is showing, so a host can drop its own copy of the finish action. */ last: [atEnd: boolean] }>();
defineSlots<{ finish?: (props: { ok: boolean; errors: number }) => unknown }>();
const uid = useId();
const id = (name: string) => `${uid}-${name}`;

const clone = (d: ServiceDesign): ServiceDesign => JSON.parse(JSON.stringify(d));
const d = ref<ServiceDesign>(clone(props.modelValue));
watch(
  () => props.modelValue,
  (v) => {
    if (JSON.stringify(v) !== JSON.stringify(d.value)) d.value = clone(v);
  },
  { deep: true },
);
watch(d, (v) => emit("update:modelValue", clone(v)), { deep: true });
// A new service's id follows its name until someone sets it (under "More").
const fresh = props.modelValue.id === "new-service";
watch(
  () => d.value.title,
  (title, before) => {
    if (!fresh || props.readonly) return;
    if (d.value.id === "new-service" || d.value.id === idFromName(before ?? "")) d.value.id = idFromName(title) || "new-service";
  },
);

// ---- sizes: the designer measures itself (it sits in any host) -------------------------------
const root = ref<HTMLElement | null>(null);
const main = ref<HTMLElement | null>(null);
const pane = ref<HTMLElement | null>(null);
const width = ref(800);
const mainWidth = ref(800);
const paneWidth = ref(380);
let observer: ResizeObserver | null = null;
onMounted(() => {
  const measure = () => {
    width.value = root.value?.getBoundingClientRect().width || width.value;
    mainWidth.value = main.value?.getBoundingClientRect().width || mainWidth.value;
    paneWidth.value = pane.value?.getBoundingClientRect().width || paneWidth.value;
  };
  measure();
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(measure);
  for (const el of [root.value, main.value, pane.value]) if (el) observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());
/** Room for the preview beside the steps (62rem). */
const side = computed(() => width.value >= 992);
/** Room for the journey list beside the chosen journey (44rem of the steps' column). */
const masterDetail = computed(() => mainWidth.value >= 704);

// ---- the preview ----------------------------------------------------------------------------
// On by default when it fits beside; narrow, it is a toggle that takes the steps' place.
const previewChoice = ref<boolean | null>(null);
const preview = computed(() => previewChoice.value ?? side.value);
watch(pane, (el) => {
  if (el && observer) observer.observe(el);
});

// ---- the steps ------------------------------------------------------------------------------
type StepKey = "service" | "roles" | "journeys" | "review";
const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: "service", label: "Service", hint: "Name the service and say what it is for." },
  { key: "roles", label: "Roles", hint: "Who delivers it, and who starts and finishes each journey." },
  { key: "journeys", label: "Journeys", hint: "The journeys people take in this service: their screens and questions." },
  { key: "review", label: "Review", hint: "The service at a glance, and anything still to fix." },
];
const at = ref(0);
const step = computed(() => STEPS[at.value]!);
async function go(i: number) {
  at.value = Math.max(0, Math.min(STEPS.length - 1, i));
  // Narrow, the preview took the steps' place: going to a step shows it.
  if (!side.value) previewChoice.value = false;
  await nextTick();
  root.value?.querySelector<HTMLElement>(".yj-steps [aria-current='step']")?.focus();
}
const last = computed(() => at.value === STEPS.length - 1);
watch(last, (v) => emit("last", v), { immediate: true });

// ---- journeys -------------------------------------------------------------------------------
const titleOf = (j: JourneyDesign, i: number) => j.title || j.id || `Journey ${i + 1}`;
/** The journey being edited; narrow, null shows the list. */
const chosen = ref<number | null>(d.value.journeys.length ? 0 : null);
const editing = computed(() => (chosen.value !== null && d.value.journeys[chosen.value] ? chosen.value : null));
/** Narrow: inside one journey (a back link to the list), or the list. */
const inside = ref(false);
async function choose(i: number) {
  chosen.value = i;
  inside.value = true;
  await nextTick();
  document.getElementById(id("journey-title"))?.focus();
}
async function backToList() {
  inside.value = false;
  await nextTick();
  root.value?.querySelector<HTMLButtonElement>(`[data-pick="${chosen.value}"]`)?.focus();
}
function addJourney() {
  let n = d.value.journeys.length + 1;
  while (d.value.journeys.some((j) => j.id === `journey-${n}`)) n++;
  d.value.journeys.push(newJourneyDesign(`journey-${n}`, `Journey ${n}`));
  void choose(d.value.journeys.length - 1);
}
function removeJourney(i: number) {
  d.value.journeys.splice(i, 1);
  if (chosen.value === null) return;
  if (chosen.value === i) {
    chosen.value = d.value.journeys.length ? Math.min(i, d.value.journeys.length - 1) : null;
    inside.value = false;
  } else if (chosen.value > i) chosen.value--;
}
/** Move a journey, and keep focus on the moved journey's button (or its other one at the end). */
async function moveJourney(i: number, by: number) {
  const k = i + by;
  if (k < 0 || k >= d.value.journeys.length) return;
  const list = d.value.journeys;
  [list[i], list[k]] = [list[k]!, list[i]!];
  if (chosen.value === i) chosen.value = k;
  else if (chosen.value === k) chosen.value = i;
  await nextTick();
  const btn = (dir: string) => root.value?.querySelector<HTMLButtonElement>(`[data-move="${k}-${dir}"]`);
  const same = btn(by < 0 ? "up" : "down");
  (same && !same.disabled ? same : btn(by < 0 ? "down" : "up"))?.focus();
}
const setJourney = (i: number, j: JourneyDesign) => (d.value.journeys[i] = j);
const setRoles = (roles: Role[]) => (d.value.roles = roles);
const addRole = (r: Role) => !d.value.roles.some((x) => x.id === r.id) && d.value.roles.push(r);
function assign(i: number, initiate: string[], complete: string[]) {
  const j = d.value.journeys[i];
  if (!j) return;
  j.initiate = initiate;
  j.complete = complete;
}
const assignments = computed(() => d.value.journeys.map((j) => ({ id: j.id, title: j.title, initiate: j.initiate, complete: j.complete })));
const who = (ids: string[], none: string) => (ids.length ? ids.map((r) => roleLabel(r, d.value.roles)).join(", ") : none);

// ---- compiling: the review and the preview ---------------------------------------------------
const compiled = computed(() => {
  const r = designToDoc(d.value);
  if (!r.ok) return { problems: r.problems.map((message) => ({ level: "error" as const, message })), bundle: null };
  const b = compileBundle(toYaml(r.doc), { services: props.serviceNames });
  return { problems: b.problems.map((p) => ({ level: p.level, message: p.message })), bundle: b };
});
const errorCount = computed(() => compiled.value.problems.filter((p) => p.level === "error").length);
const badge = (k: StepKey) => (k === "journeys" ? String(d.value.journeys.length) : k === "review" && errorCount.value ? `${errorCount.value} to fix` : "");
</script>

<template>
  <div ref="root" class="yj yj-wizard yj-designer">
    <!-- Where you are: the four steps (also the way to jump), and the preview switch. -->
    <div class="yj-wizard-head">
      <nav aria-label="Steps" class="yj-grow">
        <ol class="yj-steps">
          <li v-for="(s, i) in STEPS" :key="s.key" :class="i < at ? 'yj-done' : i === at ? 'yj-now' : ''">
            <button type="button" class="yj-step-btn" :aria-current="i === at ? 'step' : undefined" @click="go(i)">
              <span class="yj-step-n" aria-hidden="true">{{ i + 1 }}</span>
              <span class="yj-step-label">{{ s.label }}</span>
              <span v-if="badge(s.key)" class="yj-badge" :class="s.key === 'review' && 'yj-badge-bad'">{{ badge(s.key) }}</span>
            </button>
          </li>
        </ol>
      </nav>
      <button type="button" class="yj-btn yj-select-sm" :aria-pressed="preview" @click="previewChoice = !preview">{{ preview ? "Hide preview" : "Show preview" }}</button>
    </div>
    <p class="yj-small yj-muted yj-mt">
      <span class="yj-title">Step {{ at + 1 }} of {{ STEPS.length }}: {{ step.label }}.</span> {{ step.hint }}
    </p>

    <div class="yj-designer-body" :class="preview && side && 'yj-designer-split'">
      <div v-show="!preview || side" ref="main" class="yj-designer-main">
        <!-- 1 Service -->
        <fieldset v-if="step.key === 'service'" class="yj-fieldset" :disabled="readonly">
          <legend class="yj-sr-only">Service</legend>
          <div class="yj-form-grid">
            <div class="yj-span-2">
              <label :for="id('title')" class="yj-field-label">Service name <span class="yj-required" aria-hidden="true">*</span></label>
              <input :id="id('title')" v-model="d.title" class="yj-input" placeholder="Clinic visit" />
            </div>
            <div class="yj-span-2">
              <label :for="id('summary')" class="yj-field-label">What people can do with it</label>
              <input :id="id('summary')" v-model="d.summary" class="yj-input" placeholder="Check in for your visit and see who you'll meet" />
            </div>
          </div>
          <details class="yj-details yj-mt">
            <summary>More: the service's id, icon and order</summary>
            <div class="yj-form-grid yj-mt">
              <div>
                <label :for="id('id')" class="yj-field-label">Service id <span class="yj-required" aria-hidden="true">*</span></label>
                <input :id="id('id')" v-model="d.id" class="yj-input yj-mono" placeholder="clinic-visit" pattern="[a-z][a-z0-9\-]*" :aria-describedby="id('idh')" />
                <p :id="id('idh')" class="yj-help">Lower-case words joined by '-'. Kiosks find the service by it.</p>
              </div>
              <div>
                <label :for="id('icon')" class="yj-field-label">Icon</label>
                <input :id="id('icon')" v-model="d.icon" class="yj-input" placeholder="clipboard-list" />
              </div>
              <div>
                <label :for="id('order')" class="yj-field-label">Order on the kiosk</label>
                <input
                  :id="id('order')"
                  class="yj-input"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  :value="d.order ?? ''"
                  @input="d.order = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </details>
        </fieldset>

        <!-- 2 Roles -->
        <RolesPanel v-else-if="step.key === 'roles'" :roles="d.roles" :journeys="assignments" :readonly="readonly" @update:roles="setRoles" @assign="assign" />

        <!-- 3 Journeys: the list, and the chosen journey (beside it, or into it and back) -->
        <section v-else-if="step.key === 'journeys'" class="yj-md" :class="masterDetail && 'yj-md-split'" aria-label="Journeys">
          <div v-show="masterDetail || !inside || editing === null" class="yj-md-list">
            <p v-if="!d.journeys.length" class="yj-note yj-small">A service needs at least one journey. Add one to start.</p>
            <ol class="yj-stack">
              <li v-for="(j, i) in d.journeys" :key="i" class="yj-jitem" :class="masterDetail && editing === i && 'yj-jitem-on'">
                <button type="button" class="yj-jpick" :data-pick="i" :aria-current="masterDetail && editing === i ? 'true' : undefined" @click="choose(i)">
                  <span class="yj-item-kind">Journey {{ i + 1 }} · {{ j.screens.length }} screen{{ j.screens.length === 1 ? "" : "s" }}</span>
                  <span class="yj-title yj-block">{{ titleOf(j, i) }}</span>
                  <span class="yj-help yj-block yj-m0">Started by {{ who(j.initiate, "anyone") }}</span>
                </button>
                <div v-if="!readonly" class="yj-row yj-nowrap">
                  <button type="button" class="yj-btn yj-btn-quiet yj-btn-icon" :data-move="`${i}-up`" :disabled="i === 0" :aria-label="`Move ${titleOf(j, i)} up`" :title="`Move ${titleOf(j, i)} up`" @click="moveJourney(i, -1)"><Glyph name="up" /></button>
                  <button type="button" class="yj-btn yj-btn-quiet yj-btn-icon" :data-move="`${i}-down`" :disabled="i === d.journeys.length - 1" :aria-label="`Move ${titleOf(j, i)} down`" :title="`Move ${titleOf(j, i)} down`" @click="moveJourney(i, 1)"><Glyph name="down" /></button>
                  <ConfirmAction label="Remove" :aria-label="`Remove ${titleOf(j, i)}`" :message="`Remove the journey “${titleOf(j, i)}” and its ${j.screens.length} screen${j.screens.length === 1 ? '' : 's'}?`" @confirm="removeJourney(i)" />
                </div>
              </li>
            </ol>
            <button v-if="!readonly" type="button" class="yj-btn yj-mt" @click="addJourney">+ New journey</button>
          </div>

          <div v-if="editing !== null && (masterDetail || inside)" class="yj-md-detail">
            <button v-if="!masterDetail" type="button" class="yj-back" @click="backToList"><Glyph name="back" />Journeys</button>
            <h3 :id="id('journey-title')" class="yj-title yj-md-title" tabindex="-1">{{ titleOf(d.journeys[editing]!, editing) }}</h3>
            <JourneyDesigner
              :key="editing"
              :model-value="d.journeys[editing]!"
              part="all"
              :roles="d.roles"
              :service-names="serviceNames"
              :readonly="readonly"
              @update:model-value="(v) => setJourney(editing!, v)"
              @add-role="addRole"
            />
          </div>
        </section>

        <!-- 4 Review -->
        <section v-else-if="step.key === 'review'" class="yj-stack" aria-label="Review">
          <div v-if="compiled.problems.length" class="yj-stack">
            <h3 class="yj-title yj-small">To look at</h3>
            <ul class="yj-stack">
              <li v-for="(p, i) in compiled.problems" :key="i" :class="p.level === 'error' ? 'yj-alert' : 'yj-note'">{{ p.level === "error" ? "Error" : "Warning" }}: {{ p.message }}</li>
            </ul>
          </div>
          <p v-else class="yj-note">Everything checks out.<template v-if="!$slots.finish"> This is the last step.</template></p>
          <ServiceSummary v-if="compiled.bundle" :bundle="compiled.bundle" />
        </section>
      </div>

      <!-- The live preview: what a visitor sees, rebuilt as you type. -->
      <aside v-if="preview" ref="pane" class="yj-designer-preview" aria-label="Preview">
        <div class="yj-row yj-between">
          <p class="yj-title yj-small yj-m0">Preview</p>
          <p class="yj-help yj-m0">As a visitor sees it. Try a journey.</p>
        </div>
        <p v-if="!compiled.bundle" class="yj-note yj-small yj-mt" role="status">Nothing to show until the design compiles. Review lists what to fix.</p>
        <div v-else class="yj-designer-frame">
          <FlowPreview :bundle="compiled.bundle" :layout="resolveLayout(paneWidth)" :width="paneWidth - 24" storage-key="designer.preview" />
        </div>
      </aside>
    </div>

    <!-- Previous / Next -->
    <div class="yj-wizard-foot">
      <button type="button" class="yj-btn" :disabled="at === 0" @click="go(at - 1)"><Glyph name="back" />{{ at > 0 ? STEPS[at - 1]!.label : "Previous" }}</button>
      <button v-if="!last" type="button" class="yj-btn yj-btn-primary" @click="go(at + 1)">{{ STEPS[at + 1]!.label }} →</button>
      <div v-else class="yj-wizard-finish"><slot name="finish" :ok="!errorCount" :errors="errorCount" /></div>
    </div>
  </div>
</template>
