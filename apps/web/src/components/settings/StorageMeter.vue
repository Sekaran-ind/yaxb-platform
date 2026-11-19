<script setup lang="ts">
// Preferences → Storage: what this device keeps for the kiosk (STO-1), largest first, against what
// the browser allows, and whether the browser has promised to keep it (STO-2). Measured here, on
// the device; nothing is sent.
import { HardDrive, Loader2, RefreshCw, ShieldCheck } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { askPersistence, bytesText, measureStorage, type StorageReport } from "@/lib/browser/storage-meter";

const report = ref<StorageReport | null>(null);
const busy = ref(false);
const asked = ref<string | null>(null);

async function measure() {
  busy.value = true;
  try {
    report.value = await measureStorage();
  } finally {
    busy.value = false;
  }
}
onMounted(measure);

const measured = computed(() => report.value?.categories.reduce((n, c) => n + c.bytes, 0) ?? 0);
/** The share of the quota in use, as a whole percent (at least 1 when anything is used). */
const share = computed(() => {
  const r = report.value;
  if (!r?.quota || r.used === null) return null;
  return r.used === 0 ? 0 : Math.max(1, Math.round((r.used / r.quota) * 100));
});

async function keep() {
  const ok = await askPersistence();
  asked.value = ok ? "The browser will keep this data." : "The browser didn't agree. It may still clear this data when the device runs low on space.";
  await measure();
}
</script>

<template>
  <section class="card p-5" aria-labelledby="storage-meter">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="storage-meter" class="flex items-center gap-2 text-lg font-semibold text-ink"><HardDrive class="size-5 text-brand" aria-hidden="true" /> On this device</h2>
      <button type="button" class="btn-ghost h-8 px-2 text-sm" :disabled="busy" @click="measure">
        <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><RefreshCw v-else class="size-4" aria-hidden="true" /> Measure again
      </button>
    </div>
    <p class="mt-1 text-sm text-gray-600">What this browser keeps for the kiosk. Measured here; nothing is sent.</p>

    <p v-if="!report" class="mt-4 text-sm text-gray-500">Measuring…</p>
    <template v-else>
      <div class="mt-4">
        <p class="text-sm text-ink">
          <span class="text-base font-semibold">{{ bytesText(report.used ?? measured) }}</span> used<template v-if="report.quota"> of {{ bytesText(report.quota) }} this browser allows</template>
        </p>
        <div v-if="share !== null" class="mt-2 h-2 overflow-hidden rounded-full bg-mist" role="meter" :aria-valuenow="share" aria-valuemin="0" aria-valuemax="100" :aria-label="`${share}% of the space this browser allows`">
          <div class="h-full rounded-full bg-brand" :style="{ width: `${share}%` }" />
        </div>
      </div>

      <ul v-if="report.categories.length" class="mt-4 divide-y divide-gray-100">
        <li v-for="c in report.categories" :key="c.id" class="flex items-baseline justify-between gap-4 py-2">
          <span class="min-w-0">
            <span class="block text-sm font-medium text-ink">{{ c.label }}</span>
            <span class="block text-xs text-gray-500">{{ c.detail }}</span>
          </span>
          <span class="shrink-0 text-sm text-ink tabular-nums">{{ bytesText(c.bytes) }}</span>
        </li>
      </ul>
      <p v-else class="mt-4 text-sm text-gray-500">Nothing kept yet.</p>

      <div class="mt-4 rounded-lg bg-mist px-3 py-2 text-sm">
        <p v-if="report.persisted" class="flex items-center gap-2 text-ink"><ShieldCheck class="size-4 text-success" aria-hidden="true" /> The browser has promised to keep this data, even when space runs low.</p>
        <template v-else>
          <p class="text-ink">The browser may clear this data when the device runs low on space.</p>
          <button type="button" class="mt-2 btn-light h-8 px-3 text-sm" @click="keep">Ask the browser to keep it</button>
        </template>
        <p v-if="asked" role="status" class="mt-1 text-xs text-gray-600">{{ asked }}</p>
      </div>
    </template>
  </section>
</template>
