<script setup lang="ts">
// A family's routines (RTN-12): ready-made reminders a parent switches on, with no YAML. Each sends
// a note to the parents, so nothing leaves the family; anything a routine would send outside waits
// for a parent's approval. The notes and approvals show here (and in My work where it exists).
import { Loader2 } from "@lucide/vue";
import { onMounted, ref } from "vue";
import RoutineInbox from "@/components/routines/RoutineInbox.vue";
import { api, ApiError } from "@/lib/api";

type Switch = { id: string; title: string; summary: string; on: boolean };
const switches = ref<Switch[] | null>(null);
const manage = ref(false);
const signedOut = ref(false);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);

async function load() {
  error.value = null;
  try {
    const r = await api<{ manage: boolean; switches: Switch[] }>("/api/routines/family");
    switches.value = r.switches;
    manage.value = r.manage;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) signedOut.value = true;
    else error.value = (e as Error).message;
  }
}
onMounted(load);

async function flip(s: Switch) {
  busy.value = s.id;
  error.value = null;
  try {
    const r = await api<{ on: boolean }>(`/api/routines/family/${s.id}`, { on: !s.on }, "PUT");
    s.on = r.on;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <section aria-labelledby="family-routines-h" class="space-y-4">
    <div>
      <h2 id="family-routines-h" class="font-semibold text-ink">Family routines</h2>
      <p class="text-sm text-gray-600">Reminders that come by themselves. Each one sends a note to the parents, here; nothing goes outside the family without a parent saying yes.</p>
    </div>
    <p v-if="signedOut" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-600">Open your family's space (Profile → Account) to use routines.</p>
    <p v-else-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <p v-else-if="!switches" class="flex items-center gap-2 text-sm text-gray-500"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Loading…</p>
    <template v-else>
      <ul class="space-y-2">
        <li v-for="s in switches" :key="s.id" class="card flex items-start justify-between gap-3 p-3">
          <div class="min-w-0">
            <p class="font-medium text-ink">{{ s.title }}</p>
            <p class="text-sm text-gray-600">{{ s.summary }}</p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="s.on"
            :aria-label="s.title"
            :disabled="!manage || busy === s.id"
            class="relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60"
            :class="s.on ? 'bg-brand-dark' : 'bg-gray-300'"
            @click="flip(s)"
          >
            <span class="inline-block size-5 rounded-full bg-surface shadow transition-transform" :class="s.on ? 'translate-x-5' : 'translate-x-0.5'" />
          </button>
        </li>
      </ul>
      <p v-if="!manage" class="text-xs text-gray-500">A parent who runs the family's space switches routines on and off.</p>
      <RoutineInbox />
    </template>
  </section>
</template>
