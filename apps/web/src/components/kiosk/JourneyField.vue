<script setup lang="ts">
import type { Field, SlotVia } from "@sekaran-ind/yaxb-core/journeys";
import { computed } from "vue";
import type { NotebookRecord } from "@/lib/browser/store";
import { cn } from "@/lib/cn";
import { LANGUAGES } from "@/lib/languages";

// `suggested`: the value came from slot filling (what the visitor said), for them to check.
const props = defineProps<{ field: Field; value: unknown; notebook: NotebookRecord | null; suggested?: SlotVia }>();
const emit = defineEmits<{ change: [value: unknown] }>();
const id = `jf-${props.field.id}`;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const pickSource = (sid: string) => emit("change", props.notebook?.sources.find((s) => s.id === sid) ?? null);
const VIA: Record<SlotVia, string> = {
  label: "from what you said",
  pattern: "from what you said",
  entity: "recognised in what you said",
  meaning: "matched from what you said",
  model: "filled by the assistant",
};
const ring = computed(() => (props.suggested ? "ring-2 ring-info/40" : ""));
</script>

<template>
  <label v-if="field.type === 'boolean'" class="flex items-center gap-2 text-sm text-ink">
    <input :id="id" type="checkbox" class="size-4 accent-brand" :checked="value === true" @change="emit('change', ($event.target as HTMLInputElement).checked)" />
    {{ field.label }}
    <span v-if="suggested" class="text-xs text-info">({{ VIA[suggested] }})</span>
  </label>
  <div v-else>
    <label :for="id" class="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-ink">
      <span>{{ field.label }}<span v-if="field.required" class="text-red-700"> *</span></span>
      <span v-if="suggested" class="text-xs font-normal text-info">{{ VIA[suggested] }}: please check</span>
    </label>
    <textarea v-if="field.type === 'textarea'" :id="id" :class="cn('input min-h-24', ring)" :placeholder="field.placeholder" :value="str(value)" @input="emit('change', ($event.target as HTMLTextAreaElement).value)" />
    <select v-else-if="field.type === 'select'" :id="id" :class="cn('input', ring)" :value="str(value)" @change="emit('change', ($event.target as HTMLSelectElement).value)">
      <option value="">Choose…</option>
      <option v-for="o in field.options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <select v-else-if="field.type === 'language'" :id="id" :class="cn('input', ring)" :value="str(value)" @change="emit('change', ($event.target as HTMLSelectElement).value)">
      <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option>
    </select>
    <template v-else-if="field.type === 'source'">
      <select v-if="notebook?.sources.length" :id="id" class="input" :value="(value as { id?: string } | null)?.id ?? ''" @change="pickSource(($event.target as HTMLSelectElement).value)">
        <option value="">Choose a source…</option>
        <option v-for="s in notebook.sources" :key="s.id" :value="s.id">{{ s.title }}</option>
      </select>
      <p v-else class="rounded-md bg-mist px-3 py-2 text-sm text-gray-600">This notebook has no sources yet. Add one in My notebook first.</p>
    </template>
    <input
      v-else
      :id="id"
      :class="cn('input', ring)"
      :type="field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.entity === 'email' ? 'email' : field.entity === 'phone' ? 'tel' : 'text'"
      :autocomplete="field.type === 'password' ? 'off' : undefined"
      :inputmode="field.type === 'number' ? 'decimal' : undefined"
      step="any"
      :placeholder="field.placeholder"
      :value="str(value)"
      @input="emit('change', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="field.description && !field.placeholder" class="mt-1 text-xs text-gray-500">{{ field.description }}</p>
  </div>
</template>
