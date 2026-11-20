<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/cn";
import { useApiQuery } from "@/lib/queries";

type Size = { bytes: number; limitBytes: number; percent: number; level: "ok" | "warn" | "critical" };

// How full this site's database is. Hidden where the database reports no size (a local run) or the
// caller isn't the administrator. Businesses' names and content never appear here.
const { data } = useApiQuery<{ size: Size | null }>(["admin", "database"], "/api/admin/database");
const size = computed(() => data.value?.size ?? null);
const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`);
</script>

<template>
  <section v-if="size" class="card p-5" aria-labelledby="db-size-title">
    <h3 id="db-size-title" class="font-semibold text-ink">Database size</h3>
    <p class="mt-1 text-sm text-gray-500">{{ mb(size.bytes) }} of {{ mb(size.limitBytes) }} ({{ size.percent }}%). Checked daily; at 70% it is logged as a warning and at 90% as critical.</p>
    <div class="mt-2 h-2 overflow-hidden rounded-full bg-mist" role="img" :aria-label="`${size.percent}% of the database limit used`">
      <div :class="cn('h-full rounded-full', size.level === 'ok' ? 'bg-brand' : size.level === 'warn' ? 'bg-warning' : 'bg-danger')" :style="{ width: `${Math.min(100, size.percent)}%` }" />
    </div>
    <p v-if="size.level !== 'ok'" :class="cn('mt-2 rounded-lg px-3 py-2 text-sm', size.level === 'warn' ? 'caution' : 'bg-danger/10 text-red-800')" role="status">
      {{ size.level === "warn" ? "The database is getting full." : "The database is nearly full." }} Records expire on their own (30 days, or a service's period on the paid plan); if it keeps growing, move the biggest business to its own database.
    </p>
  </section>
</template>
