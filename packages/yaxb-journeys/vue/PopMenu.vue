<script setup lang="ts">
// A small popover menu: a button and a list, closed by Escape or a click outside.
import { onBeforeUnmount, ref, watch } from "vue";
import Glyph from "./Glyph.vue";

withDefaults(defineProps<{ label: string; align?: "start" | "end" }>(), { align: "end" });
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const close = () => (open.value = false);
const onDoc = (e: MouseEvent) => !root.value?.contains(e.target as Node) && close();
const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();

const unlisten = () => {
  document.removeEventListener("mousedown", onDoc);
  document.removeEventListener("keydown", onKey);
};
watch(open, (o) => {
  if (!o) return unlisten();
  document.addEventListener("mousedown", onDoc);
  document.addEventListener("keydown", onKey);
});
// The watcher stops on unmount, so remove the listeners here too.
onBeforeUnmount(unlisten);
</script>

<template>
  <div ref="root" class="yj-pop">
    <button type="button" class="yj-pop-button" :aria-label="label" :aria-expanded="open" @click="open = !open">
      <slot name="button"><Glyph name="more" /></slot>
    </button>
    <div v-if="open" role="menu" class="yj-pop-menu" :data-align="align">
      <slot :close="close" />
    </div>
  </div>
</template>
