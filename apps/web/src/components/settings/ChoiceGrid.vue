<script setup lang="ts" generic="T extends string">
import { Check } from "@lucide/vue";
import { cn } from "@/lib/cn";

defineProps<{ name: string; options: readonly { id: T; label: string; description: string }[]; value: T }>();
const emit = defineEmits<{ change: [value: T] }>();
</script>

<template>
  <fieldset class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <legend class="sr-only">{{ name }}</legend>
    <label v-for="o in options" :key="o.id" :class="cn('flex cursor-pointer flex-col rounded-lg border-2 p-3', value === o.id ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-gray-300')">
      <input type="radio" :name="name" :value="o.id" class="sr-only" :checked="value === o.id" @change="emit('change', o.id)" />
      <span class="flex items-center justify-between text-sm font-medium text-ink">{{ o.label }} <Check v-if="value === o.id" class="size-4 text-brand" aria-label="Selected" /></span>
      <span class="mt-1 text-xs text-gray-500">{{ o.description }}</span>
    </label>
  </fieldset>
</template>
