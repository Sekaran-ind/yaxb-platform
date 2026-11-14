<script setup lang="ts">
// The app's text dialog (composables/dialog.ts `askText`): a modal overlay on <dialog> (the browser
// traps focus and closes it with Esc), with a title, one labelled field and Save / Cancel. Mounted
// once in App.vue, so any screen can ask without the browser's prompt().
import { X } from "@lucide/vue";
import { computed, nextTick, ref, useId, watch } from "vue";
import { answerText, pendingText } from "@/composables/dialog";

const dialog = ref<HTMLDialogElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const text = ref("");
const uid = useId();
const ask = computed(() => pendingText.value);
const ok = computed(() => !ask.value?.required || Boolean(text.value.trim()));

watch(
  ask,
  async (a) => {
    const d = dialog.value;
    if (!d) return;
    if (a) {
      text.value = a.value ?? "";
      if (!d.open) d.showModal();
      await nextTick();
      input.value?.focus();
      input.value?.select();
    } else if (d.open) d.close();
  },
  { flush: "post" },
);
const submit = () => ok.value && answerText(text.value);
// Esc, the close button or a click outside: cancelled.
const cancel = () => pendingText.value && answerText(null);
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="`${uid}-title`"
    class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl bg-surface p-0 text-body shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    @close="cancel"
    @click="(e) => e.target === dialog && cancel()"
  >
    <form v-if="ask" class="space-y-4 p-5" @submit.prevent="submit">
      <div class="flex items-start justify-between gap-3">
        <h2 :id="`${uid}-title`" class="text-base font-semibold text-ink">{{ ask.title }}</h2>
        <button type="button" class="-mt-1 -mr-1 rounded-full p-1.5 text-gray-500 hover:bg-mist hover:text-ink" aria-label="Cancel" @click="cancel"><X class="size-4" aria-hidden="true" /></button>
      </div>
      <label class="block text-sm">
        <span class="mb-1.5 block font-medium text-ink">{{ ask.label }}</span>
        <input ref="input" v-model="text" class="input" :maxlength="ask.maxLength" :placeholder="ask.placeholder" autocomplete="off" />
      </label>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-light h-10" @click="cancel">Cancel</button>
        <button type="submit" class="btn-primary h-10" :disabled="!ok">{{ ask.confirm }}</button>
      </div>
    </form>
  </dialog>
</template>
