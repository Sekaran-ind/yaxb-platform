<script setup lang="ts">
// Design a whole service: its details, its journeys (each with screens), and, in the side panel,
// the roles that deliver it and who starts and finishes each journey. Bind with v-model to a
// ServiceDesign (forms.ts); designToDoc and toYaml give the nested YAML (nested.ts).
import { newJourneyDesign, type JourneyDesign, type ServiceDesign } from "@sekaran-ind/yaxb-journeys/forms";
import type { Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed, ref, useId, watch } from "vue";
import JourneyDesigner from "./JourneyDesigner.vue";
import RolesPanel from "./RolesPanel.vue";

const props = defineProps<{ modelValue: ServiceDesign; serviceNames?: readonly string[]; readonly?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [design: ServiceDesign] }>();
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

const open = ref<number | null>(0);
function addJourney() {
  let n = d.value.journeys.length + 1;
  while (d.value.journeys.some((j) => j.id === `journey-${n}`)) n++;
  d.value.journeys.push(newJourneyDesign(`journey-${n}`, `Journey ${n}`));
  open.value = d.value.journeys.length - 1;
}
function removeJourney(i: number) {
  if (!window.confirm(`Remove the journey "${d.value.journeys[i]!.title || d.value.journeys[i]!.id}" and its screens?`)) return;
  d.value.journeys.splice(i, 1);
  open.value = null;
}
const setJourney = (i: number, j: JourneyDesign) => (d.value.journeys[i] = j);
const setRoles = (roles: Role[]) => (d.value.roles = roles);
function assign(i: number, initiate: string[], complete: string[]) {
  const j = d.value.journeys[i];
  if (!j) return;
  j.initiate = initiate;
  j.complete = complete;
}
const assignments = computed(() => d.value.journeys.map((j) => ({ id: j.id, title: j.title, initiate: j.initiate, complete: j.complete })));
const screensOf = (j: JourneyDesign) => `${j.screens.length} screen${j.screens.length === 1 ? "" : "s"}`;
</script>

<template>
  <div class="yj yj-designer">
    <div class="yj-designer-main yj-stack">
      <fieldset class="yj-fieldset" :disabled="readonly">
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

      <section class="yj-stack" aria-label="Journeys">
        <div class="yj-head">
          <h3 class="yj-title">Journeys</h3>
          <button v-if="!readonly" type="button" class="yj-btn" @click="addJourney">+ New journey</button>
        </div>
        <p v-if="!d.journeys.length" class="yj-note yj-small">A service needs at least one journey.</p>
        <div v-for="(j, i) in d.journeys" :key="i" class="yj-panel yj-journey">
          <div class="yj-panel-head">
            <button type="button" class="yj-screen-toggle" :aria-expanded="open === i" @click="open = open === i ? null : i">
              <span class="yj-item-kind">Journey {{ i + 1 }} · {{ screensOf(j) }}</span>
              <span class="yj-title yj-block">{{ j.title || j.id }}</span>
            </button>
            <button v-if="!readonly" type="button" class="yj-btn yj-btn-quiet" :aria-label="`Remove journey ${j.id}`" @click="removeJourney(i)">Remove</button>
          </div>
          <div v-if="open === i" class="yj-panel-body">
            <JourneyDesigner :model-value="j" :roles="d.roles" :service-names="serviceNames" :readonly="readonly" @update:model-value="(v) => setJourney(i, v)" />
          </div>
        </div>
      </section>
    </div>

    <aside class="yj-designer-side yj-panel" aria-label="Roles">
      <div class="yj-panel-body">
        <RolesPanel :roles="d.roles" :journeys="assignments" :readonly="readonly" @update:roles="setRoles" @assign="assign" />
      </div>
    </aside>
  </div>
</template>
