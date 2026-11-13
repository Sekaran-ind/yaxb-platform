<script setup lang="ts" generic="T extends string">
// One of 2–5 views of the same thing (Design / YAML / Preview…, Open / Handled / All): a row of
// pressed buttons in a pill track. Sibling sections use the adaptive nav instead (docs/ux/patterns.md).
// The package's twin is `.yj-segment`, with the same look.
import { cn } from "@/lib/cn";

defineProps<{ options: readonly { value: T; label: string }[]; label: string }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="inline-flex max-w-full flex-wrap gap-0.5 rounded-full bg-mist p-0.5" role="group" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      :aria-pressed="model === o.value"
      :class="cn('min-h-8 rounded-full px-3 py-1 text-[13px] font-medium', model === o.value ? 'bg-surface text-ink shadow-sm' : 'text-gray-600 hover:text-ink')"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>
