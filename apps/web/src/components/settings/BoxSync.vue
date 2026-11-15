<script setup lang="ts">
// Preferences → Storage → Sync with the box (SYN-5..6): whether this kiosk syncs, when it last did,
// and the conflict list: each clash in plain words, with keep this device's or keep the box's.
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RefreshCw } from "@lucide/vue";
import { computed } from "vue";
import { conflictLabel, resolveConflict, syncConflicts, syncNow, syncState } from "@/composables/sync";

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const status = computed(() => {
  const s = syncState.value;
  if (s.syncing) return "Syncing…";
  if (s.error) return `Can't reach the box just now: changes are kept here and sent when it's back. (${s.error})`;
  return `Last synced ${when(s.lastSync)}.`;
});
</script>

<template>
  <section v-if="syncState.on" class="mt-4 rounded-2xl bg-mist p-4" aria-labelledby="box-sync-title">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="box-sync-title" class="flex items-center gap-2 font-semibold text-ink">
        <CloudOff v-if="syncState.error" class="size-4 text-gray-500" aria-hidden="true" />
        <CheckCircle2 v-else class="size-4 text-brand" aria-hidden="true" />
        Sync with the box
      </h3>
      <button type="button" class="btn-light h-9 text-sm" :disabled="syncState.syncing" @click="syncNow">
        <Loader2 v-if="syncState.syncing" class="size-4 animate-spin" aria-hidden="true" /><RefreshCw v-else class="size-4" aria-hidden="true" /> Sync now
      </button>
    </div>
    <p class="mt-1 text-sm text-gray-600">Notebooks, conversations, the Scheduler and the services on this kiosk are kept on this device too, so it works offline. {{ status }}</p>

    <div v-if="syncConflicts.length" class="mt-3 space-y-2">
      <h4 class="flex items-center gap-2 text-sm font-semibold text-ink"><AlertTriangle class="size-4 text-ink" aria-hidden="true" /> Changed here and on the box ({{ syncConflicts.length }})</h4>
      <p class="text-sm text-gray-600">Each was changed on this device and somewhere else before they synced. Choose which copy to keep.</p>
      <ul class="space-y-2">
        <li v-for="c in syncConflicts" :key="c.key" class="rounded-xl bg-surface p-3 ring-1 ring-gray-200">
          <p class="font-medium text-ink">{{ conflictLabel(c).title }}</p>
          <p class="text-xs text-gray-500">
            {{ conflictLabel(c).kind }} ·
            {{ c.mine === null ? "deleted on this device" : "changed on this device" }} ·
            {{ !c.theirs || c.theirs.deleted ? "deleted on the box" : `changed on the box ${when(c.theirs.updatedAt)}` }}
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <ConfirmAction
              label="Keep this device's"
              confirm-label="Keep this device's"
              :message="`Keep this device's copy of “${conflictLabel(c).title}”? The box's copy is replaced.`"
              trigger-class="btn-light h-9 text-sm"
              @confirm="resolveConflict(c.key, 'mine')"
            />
            <ConfirmAction
              label="Keep the box's"
              confirm-label="Keep the box's"
              :message="`Keep the box's copy of “${conflictLabel(c).title}”? This device's change is discarded.`"
              trigger-class="btn-light h-9 text-sm"
              @confirm="resolveConflict(c.key, 'theirs')"
            />
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
