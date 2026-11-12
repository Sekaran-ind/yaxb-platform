<script setup lang="ts">
// Accessible modal built on <dialog> (focus trap and Esc handled by the browser).
import { X } from "@lucide/vue";
import { ref, watch } from "vue";

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);

watch(
  () => props.open,
  (open) => {
    const d = dialog.value;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  },
  { flush: "post" },
);
</script>

<template>
  <dialog
    ref="dialog"
    :aria-label="title"
    class="m-auto w-[min(56rem,calc(100%-2rem))] rounded-xl p-0 shadow-2xl backdrop:bg-black/50"
    @close="emit('close')"
    @click="(e) => e.target === dialog && emit('close')"
  >
    <div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
      <h2 class="font-semibold text-ink">{{ title }}</h2>
      <button type="button" class="rounded p-1 hover:bg-mist" aria-label="Close" @click="emit('close')"><X class="size-5" /></button>
    </div>
    <div class="max-h-[80dvh] overflow-y-auto"><slot v-if="open" /></div>
  </dialog>
</template>
