<script setup lang="ts">
// One question. `source` fields pick from the host's `sources`; `language` fields from `languages`.
import type { Field } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed, useId } from "vue";

export type SourceOption = { id: string; title: string };
export type LanguageOption = { code: string; label: string };

const DEFAULT_LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "bn", label: "Bengali" },
];

const props = defineProps<{ field: Field; value: unknown; sources?: SourceOption[]; languages?: LanguageOption[]; invalid?: boolean }>();
const emit = defineEmits<{ change: [value: unknown] }>();
const id = `yj-f-${useId()}`;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const languages = computed(() => props.languages ?? DEFAULT_LANGUAGES);
const inputType = computed(() =>
  props.field.type === "number" ? "number" : props.field.type === "date" ? "date" : props.field.entity === "email" ? "email" : props.field.entity === "phone" ? "tel" : "text",
);
const pickSource = (sid: string) => emit("change", props.sources?.find((s) => s.id === sid) ?? null);
const target = (e: Event) => e.target as HTMLInputElement;
</script>

<template>
  <div class="yj-field">
    <label v-if="field.type === 'boolean'" class="yj-check">
      <input :id="id" type="checkbox" :checked="value === true" @change="emit('change', target($event).checked)" />
      {{ field.label }}
    </label>
    <template v-else>
      <label :for="id" class="yj-field-label">
        <span>{{ field.label }}<span v-if="field.required" class="yj-required" aria-hidden="true"> *</span><span v-if="field.required" class="yj-sr-only"> (required)</span></span>
      </label>
      <textarea v-if="field.type === 'textarea'" :id="id" class="yj-input" :aria-invalid="invalid || undefined" :placeholder="field.placeholder" :value="str(value)" @input="emit('change', target($event).value)" />
      <select v-else-if="field.type === 'select'" :id="id" class="yj-input" :aria-invalid="invalid || undefined" :value="str(value)" @change="emit('change', target($event).value)">
        <option value="">Choose…</option>
        <option v-for="o in field.options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <select v-else-if="field.type === 'language'" :id="id" class="yj-input" :value="str(value)" @change="emit('change', target($event).value)">
        <option value="">Choose…</option>
        <option v-for="l in languages" :key="l.code" :value="l.code">{{ l.label }}</option>
      </select>
      <template v-else-if="field.type === 'source'">
        <select v-if="sources?.length" :id="id" class="yj-input" :aria-invalid="invalid || undefined" :value="(value as { id?: string } | null)?.id ?? ''" @change="pickSource(target($event).value)">
          <option value="">Choose a source…</option>
          <option v-for="s in sources" :key="s.id" :value="s.id">{{ s.title }}</option>
        </select>
        <p v-else class="yj-note">There are no sources to choose from yet.</p>
      </template>
      <input
        v-else
        :id="id"
        class="yj-input"
        :type="inputType"
        :inputmode="field.type === 'number' ? 'decimal' : undefined"
        step="any"
        :aria-invalid="invalid || undefined"
        :placeholder="field.placeholder"
        :value="str(value)"
        @input="emit('change', target($event).value)"
      />
    </template>
    <p v-if="field.description && !field.placeholder" class="yj-help">{{ field.description }}</p>
  </div>
</template>
