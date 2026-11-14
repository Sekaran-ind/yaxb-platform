<script setup lang="ts">
// "Who's using Anjal?" (PRF-1): the kiosk delivers personalised services, so a device may hold several
// profiles, as a streaming app does. Each profile has its own notebooks, conversations and
// preferences; it opens with its passphrase. Visitor uses the kiosk without a profile (nothing of
// theirs is kept with a profile). The kiosk comes back here when a profile locks itself.
import { Loader2, Plus, UserRound, X } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";
import { useAccount } from "@/composables/account";
import { cn } from "@/lib/cn";

const emit = defineEmits<{ visitor: []; add: [] }>();
const account = useAccount();

const COLOURS = ["bg-violet-600", "bg-fuchsia-600", "bg-sky-700", "bg-emerald-700", "bg-amber-600", "bg-rose-600"];
const colourOf = (id: string) => COLOURS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLOURS.length]!;
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const picked = ref<string | null>(null);
const pass = ref("");
const busy = ref(false);
const wrong = ref(false);
const input = ref<HTMLInputElement | null>(null);
const pickedName = computed(() => account.list.value.find((p) => p.id === picked.value)?.nickname ?? "");

async function pick(id: string) {
  picked.value = id;
  pass.value = "";
  wrong.value = false;
  await nextTick();
  input.value?.focus();
}
async function open() {
  if (!picked.value || !pass.value) return;
  busy.value = true;
  wrong.value = false;
  try {
    if (!(await account.unlock(picked.value, pass.value))) wrong.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col items-center justify-center gap-8 overflow-y-auto px-4 py-8 text-center" aria-labelledby="who-title">
    <div>
      <h2 id="who-title" class="text-2xl font-semibold tracking-tight text-ink">Who's using Anjal?</h2>
      <p class="mt-1 text-sm text-gray-600">Your profile keeps your notebooks, conversations and preferences.</p>
    </div>

    <ul class="flex max-w-2xl flex-wrap justify-center gap-5">
      <li v-for="p in account.list.value" :key="p.id">
        <button type="button" class="group flex w-24 flex-col items-center gap-2" :aria-pressed="picked === p.id" @click="pick(p.id)">
          <span :class="cn('grid size-20 place-items-center rounded-2xl text-2xl font-semibold text-white ring-offset-2 ring-offset-surface transition group-hover:ring-2 group-hover:ring-gray-400', colourOf(p.id), picked === p.id && 'ring-2 ring-brand')">
            {{ initials(p.nickname) }}
          </span>
          <span class="max-w-full truncate text-sm text-ink">{{ p.nickname }}</span>
        </button>
      </li>
      <li>
        <button type="button" class="group flex w-24 flex-col items-center gap-2" @click="emit('visitor')">
          <span class="grid size-20 place-items-center rounded-2xl bg-mist text-gray-600 ring-1 ring-gray-200 transition group-hover:ring-gray-400"><UserRound class="size-8" aria-hidden="true" /></span>
          <span class="text-sm text-ink">Visitor</span>
        </button>
      </li>
      <li>
        <button type="button" class="group flex w-24 flex-col items-center gap-2" @click="emit('add')">
          <span class="grid size-20 place-items-center rounded-2xl border-2 border-dashed border-gray-300 text-gray-500 transition group-hover:border-gray-500 group-hover:text-ink"><Plus class="size-8" aria-hidden="true" /></span>
          <span class="text-sm text-ink">Add a profile</span>
        </button>
      </li>
    </ul>

    <form v-if="picked" class="w-full max-w-xs space-y-2 text-left" @submit.prevent="open">
      <div class="flex items-center justify-between">
        <label for="who-pass" class="text-sm font-medium text-ink">{{ pickedName }}'s passphrase</label>
        <button type="button" class="grid size-8 place-items-center rounded-full text-gray-500 hover:bg-mist hover:text-ink" aria-label="Choose another profile" @click="picked = null"><X class="size-4" aria-hidden="true" /></button>
      </div>
      <input id="who-pass" ref="input" v-model="pass" type="password" class="input" autocomplete="current-password" :aria-invalid="wrong" :aria-describedby="wrong ? 'who-wrong' : undefined" />
      <p v-if="wrong" id="who-wrong" role="alert" class="text-sm text-red-800">That passphrase isn't right.</p>
      <button type="submit" class="btn-primary w-full justify-center" :disabled="busy || !pass"><Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /> Open</button>
    </form>
    <p class="max-w-sm text-xs text-gray-500">Profiles stay on this device. A profile locks itself after 10 quiet minutes and the kiosk comes back here.</p>
  </section>
</template>
