<script setup lang="ts">
import { computed } from "vue";
import { useApiQuery } from "@/lib/queries";

type Allowance = { limit: number | null; used: number; left: number | null; freeAgainAt: string | null };

// The free plan's yearly syncs of a device's services and settings to the server. Nothing is shown with
// no limit (the paid plan) or when nobody is signed in (the account is what is counted).
const { data } = useApiQuery<Allowance>(["sync", "allowance"], "/api/sync/allowance");
const shown = computed(() => (data.value && data.value.limit !== null ? data.value : null));
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
</script>

<template>
  <section v-if="shown" class="rounded-lg bg-mist px-3 py-2 text-sm text-body" aria-labelledby="sync-allowance">
    <h3 id="sync-allowance" class="font-medium text-ink">Syncs to the server: {{ shown.left }} of {{ shown.limit }} left this year</h3>
    <p class="mt-1 text-xs text-gray-600">
      On the free plan the server keeps your services and their settings for 30 days. A sync puts your device's copy back with a fresh 30 days, up to {{ shown.limit }} times a year.
      <template v-if="shown.left === 0 && shown.freeAgainAt"> The next one is free on {{ date(shown.freeAgainAt) }}.</template>
    </p>
  </section>
</template>
