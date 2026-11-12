<script setup lang="ts">
// A service as a form: its details, the roles that deliver it, and its items (each opens a journey,
// a screen or a staff section). Bind with v-model to a ServiceForm (forms.ts); formToService and
// toYaml turn it into YAML.
import { newServiceItem, type ServiceForm } from "@sekaran-ind/yaxb-journeys/forms";
import type { Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { LAYOUTS } from "@sekaran-ind/yaxb-journeys/screens";
import { STAFF_SECTIONS } from "@sekaran-ind/yaxb-journeys/services";
import { ref, useId, watch } from "vue";
import RolePicker from "./RolePicker.vue";

const props = defineProps<{
  modelValue: ServiceForm;
  roles: readonly Role[];
  /** Journeys an item may open (id and title). */
  journeys: readonly { id: string; title: string }[];
  screens?: readonly string[];
  readonly?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [form: ServiceForm] }>();
const uid = useId();

const clone = (f: ServiceForm): ServiceForm => JSON.parse(JSON.stringify(f));
const form = ref<ServiceForm>(clone(props.modelValue));
watch(
  () => props.modelValue,
  (v) => {
    if (JSON.stringify(v) !== JSON.stringify(form.value)) form.value = clone(v);
  },
  { deep: true },
);
watch(form, (f) => emit("update:modelValue", clone(f)), { deep: true });

const move = (i: number, by: number) => {
  const items = form.value.items;
  const j = i + by;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j]!, items[i]!];
};
const id = (name: string) => `${uid}-${name}`;
</script>

<template>
  <div class="yj yj-stack yj-form">
    <fieldset class="yj-fieldset" :disabled="readonly">
      <legend class="yj-title">Service</legend>
      <div class="yj-form-grid">
        <div>
          <label :for="id('id')" class="yj-field-label">Id <span class="yj-required" aria-hidden="true">*</span></label>
          <input :id="id('id')" v-model="form.id" class="yj-input" placeholder="clinic-visit" pattern="[a-z][a-z0-9\-]*" />
          <p class="yj-help">Lower-case words joined by '-'. Journeys and the kiosk refer to it.</p>
        </div>
        <div>
          <label :for="id('title')" class="yj-field-label">Title <span class="yj-required" aria-hidden="true">*</span></label>
          <input :id="id('title')" v-model="form.title" class="yj-input" placeholder="Clinic visit" />
        </div>
        <div class="yj-span-2">
          <label :for="id('summary')" class="yj-field-label">Summary</label>
          <input :id="id('summary')" v-model="form.summary" class="yj-input" placeholder="What visitors can do here" />
        </div>
        <div>
          <label :for="id('icon')" class="yj-field-label">Icon</label>
          <input :id="id('icon')" v-model="form.icon" class="yj-input" placeholder="clipboard-list" />
        </div>
        <div>
          <label :for="id('order')" class="yj-field-label">Order</label>
          <input :id="id('order')" class="yj-input" type="number" :value="form.order ?? ''" @input="form.order = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)" />
        </div>
      </div>
      <fieldset class="yj-fieldset">
        <legend class="yj-field-label">Kiosk layouts</legend>
        <div class="yj-chips">
          <label v-for="l in LAYOUTS" :key="l" class="yj-chip-check"><input v-model="form.layouts" type="checkbox" :value="l" />{{ l }}</label>
        </div>
        <p class="yj-help">None ticked: every layout.</p>
      </fieldset>
      <RolePicker v-model="form.roles" :roles="roles" legend="Roles that deliver this service" :disabled="readonly" hint="Journeys of this service should be started and finished by these roles." />
    </fieldset>

    <fieldset class="yj-fieldset" :disabled="readonly">
      <legend class="yj-title">Items</legend>
      <ol class="yj-stack">
        <li v-for="(item, i) in form.items" :key="i" class="yj-card yj-step">
          <div class="yj-head">
            <p class="yj-item-kind">Item {{ i + 1 }}</p>
            <div v-if="!readonly" class="yj-row">
              <button type="button" class="yj-btn yj-btn-quiet" :disabled="i === 0" :aria-label="`Move item ${i + 1} up`" @click="move(i, -1)">↑</button>
              <button type="button" class="yj-btn yj-btn-quiet" :disabled="i === form.items.length - 1" :aria-label="`Move item ${i + 1} down`" @click="move(i, 1)">↓</button>
              <button type="button" class="yj-btn yj-btn-quiet" :aria-label="`Remove item ${i + 1}`" @click="form.items.splice(i, 1)">Remove</button>
            </div>
          </div>
          <div class="yj-form-grid">
            <div>
              <label :for="id(`k${i}`)" class="yj-field-label">Key</label>
              <input :id="id(`k${i}`)" v-model="item.key" class="yj-input" placeholder="check-in" />
            </div>
            <div>
              <label :for="id(`l${i}`)" class="yj-field-label">Label</label>
              <input :id="id(`l${i}`)" v-model="item.label" class="yj-input" placeholder="Check in for your visit" />
            </div>
            <div>
              <label :for="id(`o${i}`)" class="yj-field-label">Opens</label>
              <select :id="id(`o${i}`)" v-model="item.opens" class="yj-input" @change="item.target = ''">
                <option value="journey">A journey</option>
                <option value="screen">A kiosk screen</option>
                <option value="staff">A staff section</option>
              </select>
            </div>
            <div>
              <label :for="id(`t${i}`)" class="yj-field-label">{{ item.opens === "journey" ? "Journey" : item.opens === "screen" ? "Screen" : "Staff section" }}</label>
              <select v-if="item.opens === 'journey'" :id="id(`t${i}`)" v-model="item.target" class="yj-input">
                <option value="">Choose…</option>
                <option v-for="j in journeys" :key="j.id" :value="j.id">{{ j.title }} ({{ j.id }})</option>
                <option v-if="item.target && !journeys.some((j) => j.id === item.target)" :value="item.target">{{ item.target }} (not in this library)</option>
              </select>
              <select v-else-if="item.opens === 'screen' && screens?.length" :id="id(`t${i}`)" v-model="item.target" class="yj-input">
                <option value="">Choose…</option>
                <option v-for="s in screens" :key="s" :value="s">{{ s }}</option>
              </select>
              <select v-else-if="item.opens === 'staff'" :id="id(`t${i}`)" v-model="item.target" class="yj-input">
                <option value="">Choose…</option>
                <option v-for="s in STAFF_SECTIONS" :key="s" :value="s">{{ s }}</option>
              </select>
              <input v-else :id="id(`t${i}`)" v-model="item.target" class="yj-input" />
            </div>
            <div class="yj-span-2">
              <label :for="id(`s${i}`)" class="yj-field-label">Summary</label>
              <input :id="id(`s${i}`)" v-model="item.summary" class="yj-input" placeholder="Shown under the label (a journey's own summary when empty)" />
            </div>
            <div>
              <label :for="id(`i${i}`)" class="yj-field-label">Icon</label>
              <input :id="id(`i${i}`)" v-model="item.icon" class="yj-input" />
            </div>
          </div>
        </li>
      </ol>
      <button v-if="!readonly" type="button" class="yj-btn yj-mt" @click="form.items.push(newServiceItem())">Add item</button>
    </fieldset>
  </div>
</template>
