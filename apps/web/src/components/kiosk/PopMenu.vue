<script setup lang="ts">
// A small popover menu: a button and a list, closed by Escape or a click outside.
import { EllipsisVertical } from "@lucide/vue";
import { onBeforeUnmount, ref, watch } from "vue";

withDefaults(defineProps<{ label: string; align?: "start" | "end" }>(), { align: "end" });
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const close = () => (open.value = false);
const onDoc = (e: MouseEvent) => !root.value?.contains(e.target as Node) && close();
const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();

watch(open, (o) => {
  if (o) {
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
  } else {
    document.removeEventListener("mousedown", onDoc);
    document.removeEventListener("keydown", onKey);
  }
});
onBeforeUnmount(close);
</script>

<template>
  <div ref="root" class="relative">
    <button type="button" class="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-mist hover:text-ink" :aria-label="label" :aria-expanded="open" @click="open = !open">
      <slot name="button"><EllipsisVertical class="size-4" aria-hidden="true" /></slot>
    </button>
    <div v-if="open" role="menu" :class="['absolute z-30 mt-1 min-w-44 rounded-lg bg-surface py-1 shadow-lg ring-1 ring-gray-200', align === 'end' ? 'right-0' : 'left-0']">
      <slot :close="close" />
    </div>
  </div>
</template>
