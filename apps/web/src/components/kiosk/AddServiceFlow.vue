<script setup lang="ts">
// Adding a service to the kiosk (LIB-60..62), in three steps: what it is and the roles it needs;
// people (an administrator gives team members those roles, or invites someone); and storage (where
// the service records what happens to its journeys: none, the box, or the server on the paid plan,
// which its dashboard and activity log need). Anyone may add a published service; only an
// administrator assigns people and chooses storage, and anyone else sees where things stand.
import { Check, Loader2, UserPlus } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { catalogue, kioskViewer, loadCatalogue, loadIntoKiosk, needsOf } from "@/composables/library";
import { casesCaps } from "@/composables/case-network";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

const props = defineProps<{ entryId: string; /** Already on this kiosk: only people and storage. */ loaded?: boolean }>();
const emit = defineEmits<{ done: []; cancel: [] }>();

const service = computed(() => catalogue.value.find((s) => s.entry_id === props.entryId) ?? null);
const needs = computed(() => needsOf(props.entryId));
const admin = computed(() => kioskViewer.value.admin || kioskViewer.value.roles.includes("administrator"));
const STEPS = computed(() => (props.loaded ? ["People", "Storage"] : ["Add", "People", "Storage"]));
const at = ref(0);
const step = computed(() => STEPS.value[at.value]!);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

// ---- people ------------------------------------------------------------------------------------
type Member = { id: string; name: string; roles: string[]; status: string };
const members = ref<Member[]>([]);
/** role → member ids chosen for it. */
const chosen = ref<Record<string, string[]>>({});
onMounted(async () => {
  if (!admin.value) return;
  try {
    members.value = (await api<{ moderators: Member[] }>("/api/admin/moderators")).moderators.filter((m) => m.status !== "revoked" && m.status !== "expired");
    chosen.value = Object.fromEntries(needs.value.map((n) => [n.role, members.value.filter((m) => m.roles.includes(n.role)).map((m) => m.id)]));
  } catch (e) {
    error.value = (e as Error).message;
  }
});
const toggle = (role: string, id: string) => {
  const list = chosen.value[role] ?? [];
  chosen.value = { ...chosen.value, [role]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
};
/** Give and take the roles as chosen: one change per member whose roles differ. */
async function savePeople() {
  for (const m of members.value) {
    let roles = [...m.roles];
    for (const n of needs.value) {
      const want = (chosen.value[n.role] ?? []).includes(m.id);
      if (want && !roles.includes(n.role)) roles.push(n.role);
      if (!want && roles.includes(n.role)) roles = roles.filter((r) => r !== n.role);
    }
    if (roles.length && roles.join() !== m.roles.join()) {
      await api(`/api/admin/moderators/${encodeURIComponent(m.id)}`, { roles }, "PATCH");
      m.roles = roles;
    }
  }
}
// Invite someone: a new member with this role; their key shows once.
const inviting = ref<string | null>(null);
const inviteName = ref("");
const issuedKey = ref<{ name: string; key: string } | null>(null);
async function invite(role: string) {
  busy.value = true;
  error.value = null;
  try {
    const r = await api<{ moderator: Member; key: string }>("/api/admin/moderators", { name: inviteName.value.trim(), roles: [role] });
    members.value = [...members.value, { ...r.moderator, roles: [role] }];
    chosen.value = { ...chosen.value, [role]: [...(chosen.value[role] ?? []), r.moderator.id] };
    issuedKey.value = { name: r.moderator.name, key: r.key };
    inviting.value = null;
    inviteName.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ---- storage -----------------------------------------------------------------------------------
const storage = ref<"none" | "box" | "server">(service.value?.storage ?? "none");
const STORAGE = computed(() => [
  { id: "none" as const, label: "None", body: "Nothing leaves the devices. No dashboard or activity log for this service." },
  { id: "box" as const, label: "The organisation's box", body: "Records go to your yaxb-box on the local network. Staff devices connected to it see the dashboard and activity log." },
  { id: "server" as const, label: "The server", body: casesCaps.value.central ? "Records are kept centrally, so any staff device sees them. Part of the paid plan." : "Part of the paid plan: this kiosk doesn't have it.", disabled: !casesCaps.value.central },
]);

async function next() {
  error.value = notice.value = null;
  busy.value = true;
  try {
    if (step.value === "People" && admin.value) {
      await savePeople();
      await loadCatalogue();
    }
    if (step.value === "Storage") {
      if (admin.value && storage.value !== (service.value?.storage ?? "none")) await api(`/api/library/entries/${encodeURIComponent(props.entryId)}/storage`, { storage: storage.value }, "PUT");
      if (!props.loaded) loadIntoKiosk(props.entryId);
      await loadCatalogue();
      return emit("done");
    }
    at.value++;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const STAFFING = { ready: "has someone", invited: "invited, not signed in yet", nobody: "nobody yet" } as const;
</script>

<template>
  <div v-if="service" class="card w-full space-y-4 p-4" role="group" :aria-label="`Add ${service.title}`">
    <ol class="flex flex-wrap gap-1 text-xs" aria-label="Steps">
      <li v-for="(s, i) in STEPS" :key="s" :class="cn('rounded-full px-2.5 py-1', i === at ? 'bg-brand-dark text-on-brand' : i < at ? 'bg-success/10 text-ink' : 'bg-mist text-gray-600')" :aria-current="i === at ? 'step' : undefined">
        {{ i + 1 }}. {{ s }}
      </li>
    </ol>

    <!-- 1. What it is, and who it needs -->
    <template v-if="step === 'Add'">
      <div>
        <h4 class="font-semibold text-ink">{{ service.title }}</h4>
        <p v-if="service.summary" class="text-sm text-gray-600">{{ service.summary }}</p>
        <p class="mt-1 text-xs text-gray-500">{{ service.journeys.length }} journey{{ service.journeys.length === 1 ? "" : "s" }} · {{ service.library }}</p>
      </div>
      <div v-if="needs.length">
        <p class="text-sm font-medium text-ink">The people it needs</p>
        <ul class="mt-1 space-y-1 text-sm">
          <li v-for="n in needs" :key="n.role" class="flex flex-wrap gap-x-2">
            <span class="font-medium text-ink">{{ n.label }}</span><span :class="n.staffing === 'ready' ? 'text-success' : 'text-gray-600'">{{ STAFFING[n.staffing] }}</span>
            <span class="text-gray-500">· to {{ n.why.join("; ") }}</span>
          </li>
        </ul>
      </div>
      <p v-else class="text-sm text-gray-600">Anyone at the kiosk can use it; no staff role is needed.</p>
    </template>

    <!-- 2. People -->
    <template v-else-if="step === 'People'">
      <p v-if="!needs.length" class="text-sm text-gray-600">This service needs no staff roles.</p>
      <p v-else-if="!admin" class="caution rounded-lg px-3 py-2 text-sm">
        An administrator gives team members these roles. Until then, requests for a role with nobody wait.
        <span class="mt-1 block">{{ needs.map((n) => `${n.label}: ${STAFFING[n.staffing]}`).join(" · ") }}</span>
      </p>
      <template v-else>
      <div v-for="n in needs" :key="n.role" class="space-y-1">
        <p class="text-sm font-medium text-ink">{{ n.label }} <span class="font-normal text-gray-500">· to {{ n.why.join("; ") }}</span></p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="m in members"
            :key="m.id"
            type="button"
            :class="cn('inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm ring-1 transition', (chosen[n.role] ?? []).includes(m.id) ? 'bg-brand-dark text-on-brand ring-brand-dark' : 'bg-surface text-ink ring-gray-200 hover:bg-mist')"
            :aria-pressed="(chosen[n.role] ?? []).includes(m.id)"
            @click="toggle(n.role, m.id)"
          >
            <Check v-if="(chosen[n.role] ?? []).includes(m.id)" class="size-3.5" aria-hidden="true" />{{ m.name }}
          </button>
          <button v-if="inviting !== n.role" type="button" class="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm text-gray-600 ring-1 ring-dashed ring-gray-300 hover:text-ink" @click="(inviting = n.role), (inviteName = '')">
            <UserPlus class="size-3.5" aria-hidden="true" /> Invite someone
          </button>
        </div>
        <form v-if="inviting === n.role" class="flex flex-wrap items-end gap-2" @submit.prevent="invite(n.role)">
          <label class="text-sm"><span class="mb-1 block text-gray-600">Their name</span><input v-model="inviteName" class="input" maxlength="60" required /></label>
          <button type="submit" class="btn-primary h-10" :disabled="busy || !inviteName.trim()">Invite as {{ n.label }}</button>
          <button type="button" class="btn-ghost h-10" @click="inviting = null">Cancel</button>
        </form>
      </div>
      </template>
      <div v-if="issuedKey" class="caution space-y-1 rounded-lg px-3 py-2 text-sm" role="status">
        <p class="font-medium">{{ issuedKey.name }}'s key. It shows only now: give it to them.</p>
        <code class="block font-mono text-xs break-all text-ink">{{ issuedKey.key }}</code>
      </div>
    </template>

    <!-- 3. Storage -->
    <template v-else>
      <fieldset class="space-y-2" :disabled="!admin">
        <legend class="mb-1 text-sm text-gray-600">Where {{ service.title }} records what happens to its journeys. Its dashboard and activity log need it. Records are facts (which screen, when, who took it over), never what anyone answered.</legend>
        <label v-for="o in STORAGE" :key="o.id" :class="cn('flex cursor-pointer gap-3 rounded-xl p-3 ring-1', storage === o.id ? 'bg-brand/5 ring-brand' : 'ring-gray-200 hover:bg-mist', o.disabled && 'cursor-not-allowed opacity-60')">
          <input v-model="storage" type="radio" name="service-storage" :value="o.id" :disabled="o.disabled" class="mt-1" />
          <span><span class="block text-sm font-medium text-ink">{{ o.label }}</span><span class="block text-xs text-gray-600">{{ o.body }}</span></span>
        </label>
      </fieldset>
      <p v-if="!admin" class="text-xs text-gray-600">Only an administrator chooses this.</p>
    </template>

    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-ink">{{ notice }}</p>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn-primary h-10" :disabled="busy" @click="next">
        <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" />
        {{ step !== "Storage" ? "Next" : loaded ? "Save" : "Add to this kiosk" }}
      </button>
      <button v-if="at > 0" type="button" class="btn-light h-10" :disabled="busy" @click="at--">Back</button>
      <button type="button" class="btn-ghost h-10" @click="emit('cancel')">Cancel</button>
    </div>
  </div>
</template>
