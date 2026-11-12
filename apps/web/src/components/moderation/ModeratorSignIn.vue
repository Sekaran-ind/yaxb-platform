<script setup lang="ts">
// Sign in with a moderator key (MOD-21). The key goes to the server once and is never kept here.
import { Lock } from "@lucide/vue";
import { ref } from "vue";
import { api } from "@/lib/api";

defineProps<{ why: string }>();
const emit = defineEmits<{ signedIn: [] }>();
const key = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function signIn() {
  busy.value = true;
  error.value = null;
  try {
    await api("/api/moderator", { token: key.value });
    key.value = "";
    emit("signedIn");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="flex flex-wrap items-center gap-2 rounded-lg bg-mist px-4 py-3 text-sm" @submit.prevent="signIn">
    <Lock class="size-4 text-gray-500" aria-hidden="true" />
    <label for="moderator-key">{{ why }}</label>
    <input id="moderator-key" v-model="key" type="password" autocomplete="current-password" required class="input max-w-xs" placeholder="yaxb_mod_…" />
    <button type="submit" class="btn-primary" :disabled="busy">Sign in</button>
    <p v-if="error" role="alert" class="w-full text-red-800">{{ error }}</p>
  </form>
</template>
