<script setup lang="ts">
// The kiosk's Account screen: sign in to a profile on this device, create one, or manage the open one.
import { Loader2, Lock, UserPlus } from "@lucide/vue";
import { ref } from "vue";
import { useAccount } from "@/composables/account";
import { cn } from "@/lib/cn";
import AccountPanel from "./AccountPanel.vue";
import AccountSetup from "./AccountSetup.vue";

const account = useAccount();
const creating = ref(false);
const picked = ref<string | null>(null);
const passphrase = ref("");
const error = ref("");
const busy = ref(false);

async function unlock() {
  if (!picked.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (await account.unlock(picked.value, passphrase.value)) {
      passphrase.value = "";
      picked.value = null;
    } else error.value = "That passphrase isn't right.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AccountPanel v-if="account.profile.value" />
  <AccountSetup v-else-if="creating" @done="creating = false" @cancel="creating = false" />
  <div v-else class="space-y-4">
    <section class="card p-5">
      <h2 class="text-lg font-semibold text-ink">Your profile</h2>
      <p class="mt-1 text-sm text-gray-500">
        A profile remembers your language, interests and how you like to be helped, and sets the kiosk up for you. It stays on this device, locked with your passphrase, and signs out after 10 quiet minutes.
      </p>
      <div v-if="account.list.value.length" class="mt-4 space-y-3">
        <p class="text-sm font-medium text-ink">Sign in</p>
        <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Profiles on this device">
          <button
            v-for="r in account.list.value"
            :key="r.id"
            type="button"
            role="radio"
            :aria-checked="picked === r.id"
            :class="cn('rounded-full px-4 py-1.5 text-sm ring-1', picked === r.id ? 'bg-brand-dark text-on-brand ring-brand' : 'bg-surface text-ink ring-gray-200 hover:ring-brand')"
            @click="(picked = r.id), (error = '')"
          >
            {{ r.nickname }}
          </button>
        </div>
        <form v-if="picked" class="flex flex-wrap gap-2" @submit.prevent="unlock">
          <label for="acct-pass" class="sr-only">Passphrase</label>
          <input id="acct-pass" v-model="passphrase" type="password" class="input max-w-xs" placeholder="Passphrase" autocomplete="current-password" required />
          <button type="submit" class="btn-primary" :disabled="busy"><Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Lock v-else class="size-4" aria-hidden="true" /> Open</button>
        </form>
        <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
      </div>
      <button type="button" class="btn-light mt-4" @click="creating = true"><UserPlus class="size-4" aria-hidden="true" /> Create a profile</button>
    </section>
  </div>
</template>
