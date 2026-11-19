<script setup lang="ts">
// How people sign in to this space (IDN-34), for its administrator: which ways open it, whether staff
// (members with roles) must use a passkey, and how long a sign-in lasts here. The server checks every
// request against these; a change that would sign the administrator out is refused.
import { ShieldCheck } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { api } from "@/lib/api";
import ToggleRow from "@/components/settings/ToggleRow.vue";

type Policy = { methods: string[]; staff_passkeys: boolean; session_hours: number; updated_at: string | null };
const METHOD_LABEL: Record<string, { label: string; detail: string }> = {
  passkey: { label: "Passkeys", detail: "Fingerprint, face or screen lock: the strongest." },
  oidc: { label: "Google", detail: "A verified email." },
  recovery: { label: "Recovery codes", detail: "For getting back in when a passkey is lost." },
};
const HOURS_LABEL: Record<number, string> = { 8: "A shift (8 hours)", 24: "A day", 168: "A week", 720: "A month" };

const available = ref(false);
const policy = ref<Policy | null>(null);
const methods = ref<string[]>([]);
const hours = ref<number[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

onMounted(async () => {
  try {
    const r = await api<{ policy: Policy; methods: string[]; hours: number[] }>("/api/identity/space-policy");
    policy.value = { ...r.policy, methods: [...r.policy.methods] };
    methods.value = r.methods;
    hours.value = r.hours;
    available.value = true;
  } catch {
    available.value = false; // accounts not set up, or not this space's administrator
  }
});

const problem = computed(() => {
  const p = policy.value;
  if (!p) return null;
  if (!p.methods.length) return "Keep at least one way to sign in.";
  if (p.staff_passkeys && !p.methods.includes("passkey")) return "Allow passkeys for staff to use them.";
  return null;
});
function toggle(m: string, on: boolean) {
  if (!policy.value) return;
  policy.value.methods = on ? [...new Set([...policy.value.methods, m])] : policy.value.methods.filter((x) => x !== m);
}
async function save() {
  if (!policy.value || problem.value) return void (error.value = problem.value);
  busy.value = true;
  error.value = notice.value = null;
  try {
    const { methods: ms, staff_passkeys, session_hours } = policy.value;
    const r = await api<{ policy: Policy }>("/api/identity/space-policy", { methods: ms, staff_passkeys, session_hours }, "PUT");
    policy.value = { ...r.policy, methods: [...r.policy.methods] };
    notice.value = "Saved. It holds for everyone within a minute.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section v-if="available && policy" class="card space-y-4 p-5" aria-labelledby="rules-h">
    <div>
      <h3 id="rules-h" class="flex items-center gap-2 font-semibold text-ink"><ShieldCheck class="size-5 text-brand" aria-hidden="true" /> How people sign in to this space</h3>
      <p class="mt-1 text-sm text-gray-600">These rules hold for everyone who opens this space with their account. Services can still ask for more on a screen (an approval, a payment).</p>
    </div>
    <fieldset class="space-y-1">
      <legend class="mb-1 text-sm font-medium text-ink">Ways to sign in</legend>
      <label v-for="m in methods" :key="m" class="flex min-h-11 items-start gap-3 rounded-xl px-3 py-2 hover:bg-mist">
        <input type="checkbox" class="mt-0.5 size-4 accent-brand" :checked="policy.methods.includes(m)" @change="toggle(m, ($event.target as HTMLInputElement).checked)" />
        <span class="min-w-0">
          <span class="block text-sm text-ink">{{ METHOD_LABEL[m]?.label ?? m }}</span>
          <span class="block text-xs text-gray-500">{{ METHOD_LABEL[m]?.detail }}</span>
        </span>
      </label>
    </fieldset>
    <ToggleRow label="Staff sign in with a passkey" description="Members with a role here (moderators, reviewers, administrators and your own roles) must use a passkey." :checked="policy.staff_passkeys" @change="(v) => policy && (policy.staff_passkeys = v)" />
    <label class="block text-sm">
      <span class="mb-1 block font-medium text-ink">A sign-in lasts here for</span>
      <select v-model.number="policy.session_hours" class="input max-w-xs">
        <option v-for="h in hours" :key="h" :value="h">{{ HOURS_LABEL[h] ?? `${h} hours` }}</option>
      </select>
    </label>
    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-ink">{{ notice }}</p>
    <button type="button" class="btn-primary" :disabled="busy || Boolean(problem)" @click="save">Save the rules</button>
  </section>
</template>
