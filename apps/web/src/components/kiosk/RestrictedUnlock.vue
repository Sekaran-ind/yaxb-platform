<script setup lang="ts">
// Leaving Restricted Mode (RST-5): staff only, with the PIN set when it was turned on. The kiosk is
// left as it was set up (services, documents, people); only the front-desk lock is lifted.
import { Loader2, Lock, X } from "@lucide/vue";
import { nextTick, onMounted, ref } from "vue";
import { unlockRestricted } from "@/composables/restricted";

const emit = defineEmits<{ close: []; unlocked: [] }>();
const pin = ref("");
const busy = ref(false);
const wrong = ref(false);
const input = ref<HTMLInputElement | null>(null);
onMounted(async () => {
  await nextTick();
  input.value?.focus();
});
async function unlock() {
  busy.value = true;
  wrong.value = false;
  try {
    if (await unlockRestricted(pin.value)) emit("unlocked");
    else wrong.value = true;
  } finally {
    busy.value = false;
    pin.value = "";
  }
}
</script>

<template>
  <div class="absolute inset-0 z-40 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="unlock-title" @keydown.esc="emit('close')">
    <form class="card w-full max-w-xs space-y-3 p-5" @submit.prevent="unlock">
      <div class="flex items-center justify-between">
        <h3 id="unlock-title" class="flex items-center gap-2 font-semibold text-ink"><Lock class="size-4 text-brand" aria-hidden="true" /> Staff: leave front desk</h3>
        <button type="button" class="grid size-9 place-items-center rounded-full text-gray-500 hover:bg-mist hover:text-ink" aria-label="Cancel" @click="emit('close')"><X class="size-4" aria-hidden="true" /></button>
      </div>
      <label for="unlock-pin" class="block text-sm text-gray-700">The PIN set when Restricted Mode was turned on</label>
      <input id="unlock-pin" ref="input" v-model="pin" class="input text-center text-lg tracking-[0.5em]" inputmode="numeric" type="password" autocomplete="off" maxlength="8" :aria-invalid="wrong" />
      <p v-if="wrong" role="alert" class="text-sm text-red-800">That PIN isn't right.</p>
      <button type="submit" class="btn-primary w-full justify-center" :disabled="busy || pin.length < 4"><Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /> Unlock</button>
    </form>
  </div>
</template>
