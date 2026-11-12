<script setup lang="ts">
import { Lock } from "@lucide/vue";
import { cn } from "@/lib/cn";

defineProps<{ label: string; description?: string; checked: boolean; locked?: boolean }>();
const emit = defineEmits<{ change: [value: boolean] }>();
</script>

<template>
  <label :class="cn('flex items-start justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-mist', locked && 'opacity-70')">
    <span>
      <span class="flex items-center gap-1.5 text-sm font-medium text-ink">{{ label }}<Lock v-if="locked" class="size-3.5 text-gray-400" aria-label="Always on" /></span>
      <span v-if="description" class="block text-xs text-gray-500">{{ description }}</span>
    </span>
    <input type="checkbox" role="switch" class="mt-0.5 size-5 shrink-0 accent-brand" :checked="checked" :disabled="locked" @change="emit('change', ($event.target as HTMLInputElement).checked)" />
  </label>
</template>
