<script setup lang="ts">
// Design a whole service as a sequence of steps, with a breadcrumb and Previous / Next:
//   Service → Roles → Journeys → (each journey: Details → Screens) → Review
// The breadcrumb shows where the step sits (Service › Journeys › Check in › Screens); the step list
// jumps anywhere. Bind with v-model to a ServiceDesign (forms.ts); designToDoc and toYaml give the
// nested YAML (nested.ts). The Review step compiles the design and lists what to fix.
// The last step offers the host's next action in place of Next: fill the `finish` slot (props: ok,
// errors) with it, e.g. "Create service" or "Submit for review". Without it the step says it is the end.
import { compileBundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { designToDoc, newJourneyDesign, toYaml, type JourneyDesign, type ServiceDesign } from "@sekaran-ind/yaxb-journeys/forms";
import { roleLabel, type Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed, nextTick, ref, useId, watch } from "vue";
import ConfirmAction from "./ConfirmAction.vue";
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

// ---- the steps ------------------------------------------------------------------------------
type Step = { key: string; label: string; kind: "service" | "roles" | "journeys" | "journey" | "screens" | "review"; journey?: number; hint: string };
const titleOf = (j: JourneyDesign, i: number) => j.title || j.id || `Journey ${i + 1}`;
const steps = computed<Step[]>(() => [
  { key: "service", kind: "service", label: "Service", hint: "Name the service and say what it is for." },
  { key: "roles", kind: "roles", label: "Roles", hint: "Who delivers it, and who starts and finishes each journey." },
  { key: "journeys", kind: "journeys", label: "Journeys", hint: "The journeys people can take in this service." },
  ...d.value.journeys.flatMap((j, i): Step[] => [
    { key: `journey-${i}`, kind: "journey", journey: i, label: titleOf(j, i), hint: "This journey's name, and who may start and finish it." },
    { key: `screens-${i}`, kind: "screens", journey: i, label: "Screens", hint: "The screens of this journey, in order: questions, services, decisions and the end." },
  ]),
  { key: "review", kind: "review", label: "Review", hint: "The service at a glance, and anything still to fix." },
]);
const at = ref(0);
watch(
  () => steps.value.length,
  (n) => (at.value = Math.min(at.value, n - 1)),
);
const step = computed(() => steps.value[at.value]!);
const go = (i: number) => (at.value = Math.max(0, Math.min(steps.value.length - 1, i)));
const goKey = (key: string) => go(steps.value.findIndex((s) => s.key === key));

/** Service › [Journeys › <journey> ›] step: where this step sits. */
const crumbs = computed(() => {
  const s = step.value;
  const service = { label: d.value.title || d.value.id || "Service", key: "service" };
  if (s.kind === "service") return [service];
  if (s.kind === "roles" || s.kind === "journeys" || s.kind === "review") return [service, { label: s.label, key: s.key }];
  const j = d.value.journeys[s.journey!]!;
  const trail = [service, { label: "Journeys", key: "journeys" }, { label: titleOf(j, s.journey!), key: `journey-${s.journey}` }];
  return s.kind === "screens" ? [...trail, { label: "Screens", key: s.key }] : trail;
});

// ---- journeys and roles --------------------------------------------------------------------
function addJourney() {
  let n = d.value.journeys.length + 1;
  while (d.value.journeys.some((j) => j.id === `journey-${n}`)) n++;
  d.value.journeys.push(newJourneyDesign(`journey-${n}`, `Journey ${n}`));
  goKey(`journey-${d.value.journeys.length - 1}`);
}
const removeJourney = (i: number) => d.value.journeys.splice(i, 1);
const root = ref<HTMLElement | null>(null);
/** Move a journey, and keep focus on the moved journey's button (or its other one at the end). */
async function moveJourney(i: number, by: number) {
  const k = i + by;
  if (k < 0 || k >= d.value.journeys.length) return;
  const list = d.value.journeys;
  [list[i], list[k]] = [list[k]!, list[i]!];
  await nextTick();
  const at = (dir: string) => root.value?.querySelector<HTMLButtonElement>(`[data-move="${k}-${dir}"]`);
  const same = at(by < 0 ? "up" : "down");
  (same && !same.disabled ? same : at(by < 0 ? "down" : "up"))?.focus();
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

// ---- review ---------------------------------------------------------------------------------
const compiled = computed(() => {
  const r = designToDoc(d.value);
  if (!r.ok) return { problems: r.problems.map((message) => ({ level: "error" as const, message })), bundle: null };
  const b = compileBundle(toYaml(r.doc), { services: props.serviceNames });
  return { problems: b.problems.map((p) => ({ level: p.level, message: p.message })), bundle: b };
});
const errorCount = computed(() => compiled.value.problems.filter((p) => p.level === "error").length);
const last = computed(() => at.value === steps.value.length - 1);
watch(last, (v) => emit("last", v), { immediate: true });
</script>

<template>
  <div ref="root" class="yj yj-wizard">
    <!-- Where you are -->
    <div class="yj-wizard-head">
      <nav aria-label="Breadcrumb">
        <ol class="yj-crumbs">
          <li v-for="(c, i) in crumbs" :key="c.key">
            <button v-if="i < crumbs.length - 1" type="button" class="yj-crumb" @click="goKey(c.key)">{{ c.label }}</button>
            <span v-else class="yj-crumb yj-crumb-current" aria-current="step">{{ c.label }}</span>
          </li>
        </ol>
      </nav>
      <label class="yj-label yj-small">
        <span class="yj-muted">Step {{ at + 1 }} of {{ steps.length }}</span>
        <select class="yj-input yj-select-sm" :value="at" aria-label="Go to step" @change="go(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="(s, i) in steps" :key="s.key" :value="i">{{ s.kind === "screens" ? `${steps[i - 1]?.label} · Screens` : s.label }}</option>
        </select>
      </label>
    </div>
    <ol class="yj-progress" aria-hidden="true">
      <li v-for="(s, i) in steps" :key="s.key" :class="i < at ? 'yj-done' : i === at ? 'yj-now' : ''" />
    </ol>
    <p class="yj-small yj-muted yj-mt">{{ step.hint }}</p>

    <div class="yj-wizard-body">
      <!-- Service -->
      <fieldset v-if="step.kind === 'service'" class="yj-fieldset" :disabled="readonly">
        <legend class="yj-title">Service</legend>
        <div class="yj-form-grid">
          <div>
            <label :for="id('id')" class="yj-field-label">Service id <span class="yj-required" aria-hidden="true">*</span></label>
            <input :id="id('id')" v-model="d.id" class="yj-input" placeholder="clinic-visit" pattern="[a-z][a-z0-9\-]*" />
            <p class="yj-help">Lower-case words joined by '-'.</p>
          </div>
          <div>
            <label :for="id('title')" class="yj-field-label">Service title <span class="yj-required" aria-hidden="true">*</span></label>
            <input :id="id('title')" v-model="d.title" class="yj-input" placeholder="Clinic visit" />
          </div>
          <div class="yj-span-2">
            <label :for="id('summary')" class="yj-field-label">Summary</label>
            <input :id="id('summary')" v-model="d.summary" class="yj-input" placeholder="What people can do with this service" />
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
              :value="d.order ?? ''"
              @input="d.order = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </fieldset>

      <!-- Roles -->
      <RolesPanel v-else-if="step.kind === 'roles'" :roles="d.roles" :journeys="assignments" :readonly="readonly" @update:roles="setRoles" @assign="assign" />

      <!-- Journeys -->
      <section v-else-if="step.kind === 'journeys'" class="yj-stack" aria-label="Journeys">
        <p v-if="!d.journeys.length" class="yj-note yj-small">A service needs at least one journey.</p>
        <ol class="yj-stack">
          <li v-for="(j, i) in d.journeys" :key="i" class="yj-card yj-step">
            <div class="yj-head">
              <div>
                <p class="yj-item-kind">Journey {{ i + 1 }} · {{ j.screens.length }} screen{{ j.screens.length === 1 ? "" : "s" }}</p>
                <p class="yj-title">{{ titleOf(j, i) }}</p>
                <p class="yj-help">Started by {{ who(j.initiate, "anyone") }} · finished by {{ who(j.complete, "whoever started it") }}</p>
              </div>
              <div class="yj-row">
                <button type="button" class="yj-btn yj-select-sm" @click="goKey(`journey-${i}`)">Edit</button>
                <button type="button" class="yj-btn yj-select-sm" @click="goKey(`screens-${i}`)">Screens</button>
                <template v-if="!readonly">
                  <button type="button" class="yj-btn yj-btn-quiet yj-btn-icon" :data-move="`${i}-up`" :disabled="i === 0" :aria-label="`Move ${titleOf(j, i)} up`" :title="`Move ${titleOf(j, i)} up`" @click="moveJourney(i, -1)"><Glyph name="up" /></button>
                  <button type="button" class="yj-btn yj-btn-quiet yj-btn-icon" :data-move="`${i}-down`" :disabled="i === d.journeys.length - 1" :aria-label="`Move ${titleOf(j, i)} down`" :title="`Move ${titleOf(j, i)} down`" @click="moveJourney(i, 1)"><Glyph name="down" /></button>
                  <ConfirmAction label="Remove" :aria-label="`Remove ${titleOf(j, i)}`" :message="`Remove the journey “${titleOf(j, i)}” and its ${j.screens.length} screen${j.screens.length === 1 ? '' : 's'}?`" @confirm="removeJourney(i)" />
                </template>
              </div>
            </div>
          </li>
        </ol>
        <button v-if="!readonly" type="button" class="yj-btn" @click="addJourney">+ New journey</button>
      </section>

      <!-- One journey: its details, or its screens -->
      <JourneyDesigner
        v-else-if="(step.kind === 'journey' || step.kind === 'screens') && d.journeys[step.journey!]"
        :key="step.key"
        :model-value="d.journeys[step.journey!]!"
        :part="step.kind === 'journey' ? 'details' : 'screens'"
        :roles="d.roles"
        :service-names="serviceNames"
        :readonly="readonly"
        @update:model-value="(v) => setJourney(step.journey!, v)"
        @add-role="addRole"
      />

      <!-- Review -->
      <section v-else-if="step.kind === 'review'" class="yj-stack" aria-label="Review">
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

    <!-- Previous / Next -->
    <div class="yj-wizard-foot">
      <button type="button" class="yj-btn" :disabled="at === 0" @click="go(at - 1)">← {{ at > 0 ? steps[at - 1]!.label : "Previous" }}</button>
      <button v-if="!last" type="button" class="yj-btn yj-btn-primary" @click="go(at + 1)">{{ steps[at + 1]!.label }} →</button>
      <div v-else class="yj-wizard-finish"><slot name="finish" :ok="!errorCount" :errors="errorCount" /></div>
    </div>
  </div>
</template>
