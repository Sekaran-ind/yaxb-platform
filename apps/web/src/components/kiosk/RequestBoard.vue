<script setup lang="ts">
// Who has which open request, and since when (LIB-47): for moderators and administrators, from the
// beacons on the box or the cloud relay. A beacon holds the reference, titles, role and holder,
// never answers or notes, so a moderator reassigns an idle request without reading it: the device
// that has a copy sends it to the member chosen, and only they may carry on.
import type { Beacon } from "@sekaran-ind/yaxb-core/cases";
import { Loader2, RotateCcw, UserRoundCog } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { caseBoard, reassignCase } from "@/composables/cases";
import { roleName } from "@/composables/library";
import { useTeam } from "@/composables/team";

const team = useTeam();
const items = ref<Beacon[] | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const picking = ref<string | null>(null);
const member = ref("");
const reason = ref("");
const busy = ref(false);

async function load() {
  error.value = null;
  try {
    items.value = await caseBoard();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);

/** Members who may take it: those with the role it waits for. */
const candidates = (b: Beacon) => (b.role ? team.members.value.filter((m) => m.roles.includes(b.role!) && m.status !== "suspended") : []);
const idle = (iso: string) => {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? "under an hour" : h < 48 ? `${h} hour${h === 1 ? "" : "s"}` : `${Math.floor(h / 24)} days`;
};
const holder = (b: Beacon) => b.holder_name ?? (b.role ? roleName(b.role) : "the person who started it");
const stale = computed(() => (items.value ?? []).filter((b) => Date.now() - new Date(b.updated_at).getTime() > 24 * 3_600_000).length);

async function reassign(b: Beacon) {
  const m = candidates(b).find((x) => x.id === member.value);
  if (!m) return;
  busy.value = true;
  error.value = notice.value = null;
  try {
    await reassignCase(b, { id: m.id, name: m.name }, reason.value.trim() || null);
    notice.value = `${b.ref} goes to ${m.name}: the device that has it sends it on.`;
    picking.value = null;
    member.value = reason.value = "";
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="svc-board" class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="svc-board" class="flex items-center gap-2 text-base font-semibold text-ink"><UserRoundCog class="size-4 text-brand" aria-hidden="true" /> Who has which request</h3>
      <button type="button" class="btn-ghost h-10 px-3 text-sm" @click="load"><RotateCcw class="size-4" aria-hidden="true" /> Refresh</button>
    </div>
    <p class="text-sm text-gray-600">Open requests and how long since anyone worked on them. You see who has each one, not what it says. Give an idle one to someone else with the role.</p>
    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{{ notice }}</p>
    <p v-if="items === null && !error" class="flex items-center gap-2 text-sm text-gray-600"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Loading…</p>
    <p v-else-if="items && !items.length" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-600">No open requests on the box or the relay.</p>
    <p v-else-if="stale" class="caution rounded-lg px-3 py-2 text-sm">{{ stale }} untouched for more than a day.</p>
    <ul v-if="items?.length" class="grid gap-2 @lg:grid-cols-2">
      <li v-for="b in items" :key="b.case_id" class="card space-y-2 p-3">
        <div>
          <p class="text-sm font-medium text-ink">{{ b.journey_title }}</p>
          <p class="text-xs text-gray-500">{{ b.service_title }} · <span class="font-mono">{{ b.ref }}</span></p>
          <p class="mt-1 text-sm text-ink">With {{ holder(b) }} · idle {{ idle(b.updated_at) }}</p>
        </div>
        <template v-if="b.role">
          <button v-if="picking !== b.case_id" type="button" class="btn-light h-10 px-3 text-sm" @click="(picking = b.case_id), (member = ''), (reason = '')">Reassign</button>
          <form v-else class="space-y-2" @submit.prevent="reassign(b)">
            <label :for="`to-${b.case_id}`" class="block text-sm font-medium text-ink">Give it to</label>
            <select :id="`to-${b.case_id}`" v-model="member" class="input" required>
              <option value="" disabled>Choose a {{ roleName(b.role) }}…</option>
              <option v-for="m in candidates(b)" :key="m.id" :value="m.id">{{ m.name }}{{ team.onlineIds.value.has(m.id) ? " (online)" : "" }}</option>
            </select>
            <p v-if="!candidates(b).length" class="text-xs text-gray-600">Nobody else on the team has this role. An administrator gives it in For staff → Administration.</p>
            <label :for="`why-${b.case_id}`" class="block text-sm text-gray-600">Why (optional; it goes in the request's thread)</label>
            <input :id="`why-${b.case_id}`" v-model="reason" class="input" maxlength="200" />
            <div class="flex gap-2">
              <button type="submit" class="btn-primary h-10" :disabled="busy || !member">Reassign it</button>
              <button type="button" class="btn-ghost h-10" @click="picking = null">Cancel</button>
            </div>
          </form>
        </template>
        <p v-else class="text-xs text-gray-600">Waiting for the person who started it: only they can carry on.</p>
      </li>
    </ul>
  </section>
</template>
