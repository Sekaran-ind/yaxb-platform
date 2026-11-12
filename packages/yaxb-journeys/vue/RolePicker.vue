<script setup lang="ts">
// Pick roles from a catalogue, as checkboxes. `visitor` (anyone at the kiosk) is offered when asked.
import { VISITOR_ROLE, type Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed } from "vue";

const props = defineProps<{ modelValue: string[]; roles: readonly Role[]; legend: string; withVisitor?: boolean; disabled?: boolean; hint?: string }>();
const emit = defineEmits<{ "update:modelValue": [ids: string[]] }>();
const options = computed(() => [
  ...(props.withVisitor ? [{ id: VISITOR_ROLE, label: "Visitor (anyone at the kiosk)" }] : []),
  ...props.roles,
  // Roles in the YAML that the catalogue doesn't have: shown, so they can be removed.
  ...props.modelValue.filter((id) => id !== VISITOR_ROLE && !props.roles.some((r) => r.id === id)).map((id) => ({ id, label: `${id} (not in the catalogue)` })),
]);
function toggle(id: string, on: boolean) {
  emit("update:modelValue", on ? [...props.modelValue, id] : props.modelValue.filter((x) => x !== id));
}
</script>

<template>
  <fieldset class="yj-fieldset">
    <legend class="yj-field-label">{{ legend }}</legend>
    <div class="yj-chips">
      <label v-for="r in options" :key="r.id" class="yj-chip-check">
        <input type="checkbox" :checked="modelValue.includes(r.id)" :disabled="disabled" @change="toggle(r.id, ($event.target as HTMLInputElement).checked)" />
        {{ r.label }}
      </label>
    </div>
    <p v-if="hint" class="yj-help">{{ hint }}</p>
  </fieldset>
</template>
