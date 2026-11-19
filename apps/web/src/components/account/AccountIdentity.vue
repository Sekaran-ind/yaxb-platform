<script setup lang="ts">
// Preferences → Account (docs/specs/15-identity.md step 1): "Keep my things across devices".
// Signed out: sign in with a passkey (the default, IDN-10), Google (IDN-14) or a recovery code
// (IDN-21), or make an account after reading the notice (IDN-52). Signed in: the spaces (SPC-1..4),
// the ways to sign in, recovery codes, devices and sessions, sign out and delete (IDN-40).
// The profile on this device is unchanged: an account is optional (IDN-2, IDN-6).
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Check, Copy, KeyRound, Loader2, LogOut, MonitorSmartphone, Plus, ShieldCheck, Sparkles, Trash2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useIdentity, type DeviceRow, type SessionRow } from "@/composables/identity";
import PhoneSignIn from "./PhoneSignIn.vue";
import { api } from "@/lib/api";

const id = useIdentity();
const route = useRoute();
const router = useRouter();
/** The guided way: the your-account journey in the conversation. */
const guide = () => void router.push({ path: "/kiosk", query: { journey: "your-account" } });
const busy = ref<string | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const name = ref("");
const agreed = ref(false);
const creating = ref(false);
const recoveryCode = ref("");
const showRecovery = ref(false);
const codes = ref<string[] | null>(null);
const sessions = ref<{ current: string; sessions: SessionRow[] } | null>(null);
// Devices signed in with a code (IDN-17, 18, 41): approving one, and the ones signed in.
const devices = ref<DeviceRow[]>([]);
const deviceCode = ref(typeof route.query.device === "string" ? route.query.device : "");
const asking = ref<{ client: string; name: string; scopes: string[] } | null>(null);
const CLIENT: Record<string, string> = { cli: "Terminal (yaxb)", box: "Box", kiosk: "Kiosk", voice: "Voice device" };
const CLIENT_A: Record<string, string> = { cli: "a terminal", box: "a box", kiosk: "a kiosk", voice: "a voice device", handoff: "a kiosk you scanned" };
const SCOPE: Record<string, string> = { chat: "ask the kiosk as you", box: "use your box" };
async function lookUpDevice() {
  asking.value = null;
  await run("device", async () => (asking.value = await id.deviceRequest(deviceCode.value.trim())));
}
async function answerDevice(approve: boolean) {
  const name = asking.value?.name ?? "The device";
  await run("device", async () => {
    await id.approveDevice(deviceCode.value.trim(), approve);
    asking.value = null;
    deviceCode.value = "";
    devices.value = await id.devices();
  }, approve ? `${name} is signed in. It carries on by itself.` : `${name} wasn't signed in.`);
}

const copied = ref(false);
// A business's own sign-in (IDN-15): find it by its short name, then go to its provider.
const company = ref("");
const companySignIn = () =>
  run("company", async () => {
    const r = await api<{ space: string }>(`/api/identity/org/find?name=${encodeURIComponent(company.value.trim().toLowerCase())}`);
    location.href = `/api/identity/org/start?consent=1&space=${encodeURIComponent(r.space)}&return=${encodeURIComponent("/kiosk?prefs=account")}`;
  });

// Google comes back with ?signin=<why> on failure, ?signedin=1 on success.
watch(
  () => route.query.signin,
  (q) => typeof q === "string" && (error.value = q),
  { immediate: true },
);

const me = computed(() => (id.me.value.signedIn ? id.me.value : null));
// Arrived from the link a device showed: look its code up at once.
watch(me, (m) => m && deviceCode.value && !asking.value && void lookUpDevice(), { immediate: true });
const LEVEL: Record<number, string> = { 1: "signed in with a recovery code: add a passkey or Google now", 2: "signed in with a verified email", 3: "signed in with a passkey" };
const METHOD: Record<string, string> = { passkey: "Passkey", oidc: "Google", recovery: "Recovery code", phone: "Phone", email: "Email", member_key: "Member key" };
const methods = computed(() => (me.value?.methods ?? []).filter((m) => m.kind !== "recovery"));
const recoveryLeft = computed(() => (me.value?.methods ?? []).filter((m) => m.kind === "recovery").length);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "never");
const KIND: Record<string, string> = { family: "Family", business: "Business", community: "Community" };

async function run(what: string, fn: () => Promise<unknown>, done?: string) {
  busy.value = what;
  error.value = notice.value = null;
  try {
    await fn();
    if (done) notice.value = done;
  } catch (e) {
    const msg = (e as Error).message;
    // The person closed the passkey prompt: nothing to report.
    error.value = /NotAllowedError|cancel|abort/i.test(`${(e as Error).name} ${msg}`) ? null : msg;
  } finally {
    busy.value = null;
  }
}
const create = () =>
  run("create", async () => {
    const r = await id.passkeyCreate({ name: name.value.trim() || undefined, consent: agreed.value });
    if (r) creating.value = true;
  });
/** New recovery codes: shown once, here, until the page is left. */
const makeCodes = () =>
  run("codes", async () => {
    codes.value = await id.newRecoveryCodes();
    await id.reload();
  });
async function loadSessions() {
  sessions.value = await id.sessions().catch(() => null);
  devices.value = await id.devices().catch(() => []);
}
watch(me, (m) => m && void loadSessions(), { immediate: true });
async function copyCodes() {
  await navigator.clipboard?.writeText(codes.value!.join("\n")).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <div class="space-y-5">
    <p v-if="id.config.value && !id.config.value.enabled" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-700">Accounts aren't set up on this site yet. Your profile works on this device as it is.</p>

    <!-- Signed out: sign in, or make an account. -->
    <template v-else-if="!me">
      <div>
        <h3 class="text-base font-semibold text-ink">Keep my things across devices</h3>
        <p class="mt-1 text-sm text-gray-600">An account lets you use your family, business and community spaces on any device, and switch between them without signing in again. It's optional: your profile here works without one.</p>
      </div>
      <button type="button" class="btn-primary" @click="guide"><Sparkles class="size-4" aria-hidden="true" /> Sign in step by step</button>
      <p class="text-xs text-gray-500">Or straight away:</p>
      <div class="flex flex-wrap gap-2">
        <button v-if="id.passkeys.value" type="button" class="btn-light" :disabled="busy !== null" @click="run('passkey', id.passkeySignIn)">
          <Loader2 v-if="busy === 'passkey'" class="size-4 animate-spin" aria-hidden="true" /><KeyRound v-else class="size-4" aria-hidden="true" /> Sign in with a passkey
        </button>
        <button v-if="id.config.value?.google" type="button" class="btn-light" :disabled="busy !== null" @click="id.google()">Continue with Google</button>
        <button type="button" class="btn-ghost" :aria-expanded="showRecovery" @click="showRecovery = !showRecovery">Use a recovery code</button>
      </div>
      <!-- Staff of a business with its own sign-in (IDN-15). -->
      <details class="rounded-lg bg-mist px-3 py-2 text-sm">
        <summary class="cursor-pointer text-ink">Sign in with your company</summary>
        <form class="mt-2 flex flex-wrap items-end gap-2" @submit.prevent="companySignIn">
          <label class="block"><span class="mb-1 block text-gray-600">Your business's short name in Anjalai</span><input v-model="company" class="input w-56" placeholder="sri-ram-hardware" autocomplete="organization" /></label>
          <button type="submit" class="btn-light" :disabled="busy !== null || !company.trim()">Continue</button>
        </form>
        <p class="mt-1 text-xs text-gray-500">Your company's sign-in page opens. Pressing Continue agrees to the notice above: Anjal keeps only your company account's id.</p>
      </details>
      <!-- On a shared or public screen: scan with a phone that is signed in (IDN-19). -->
      <PhoneSignIn label="Sign in with my phone (scan a code)" />
      <form v-if="showRecovery" class="flex flex-wrap items-end gap-2" @submit.prevent="run('recovery', () => id.recovery(recoveryCode))">
        <label class="text-sm"><span class="mb-1 block text-gray-600">Recovery code</span><input v-model="recoveryCode" class="input w-48 font-mono uppercase" placeholder="ABCDE-23456" autocomplete="one-time-code" required /></label>
        <button type="submit" class="btn-light" :disabled="busy !== null">Sign in</button>
      </form>
      <p v-if="!id.passkeys.value && id.config.value?.enabled" class="text-xs text-gray-500">Passkeys need this site's own address (anjalai.cc) and a device with a screen lock.</p>

      <section v-if="id.passkeys.value" class="space-y-2 rounded-xl bg-mist p-3" aria-label="Make an account">
        <p class="text-sm font-medium text-ink">New here? Make an account with a passkey</p>
        <p class="text-sm text-gray-700">{{ id.config.value?.notice }}</p>
        <label class="block text-sm"><span class="mb-1 block text-gray-600">Your name, as others in your spaces see it (optional)</span><input v-model="name" class="input max-w-xs" maxlength="40" /></label>
        <label class="flex items-center gap-2 text-sm text-ink"><input v-model="agreed" type="checkbox" class="size-4" /> I've read this</label>
        <button type="button" class="btn-light" :disabled="busy !== null || !agreed" @click="create">
          <Loader2 v-if="busy === 'create'" class="size-4 animate-spin" aria-hidden="true" /><Plus v-else class="size-4" aria-hidden="true" /> Make my account
        </button>
        <p v-if="creating && !agreed" class="text-xs text-red-800">Read the notice and tick "I've read this" first.</p>
        <p v-if="id.config.value?.google" class="text-xs text-gray-500">Continuing with Google above also makes an account, under this notice.</p>
      </section>
    </template>

    <!-- Signed in. -->
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="flex items-center gap-2 text-base font-semibold text-ink"><ShieldCheck class="size-4 text-success" aria-hidden="true" /> {{ me.account.display_name ?? "Your account" }}</h3>
          <p class="text-xs text-gray-500">{{ LEVEL[me.level] ?? "signed in" }} · since {{ when(me.account.created_at) }}</p>
        </div>
        <button type="button" class="btn-ghost h-9 px-3 text-sm" :disabled="busy !== null" @click="run('out', () => id.signOut())"><LogOut class="size-4" aria-hidden="true" /> Sign out</button>
      </div>

      <!-- Spaces (SPC-1..4). -->
      <section class="space-y-2" aria-label="Your spaces">
        <h4 class="text-sm font-semibold text-ink">Your spaces</h4>
        <p v-if="me.refused" role="alert" class="caution rounded-lg px-3 py-2 text-sm">{{ me.refused.space_name }} didn't open: {{ me.refused.message }}</p>
        <p v-if="id.locked.value" class="caution rounded-lg px-3 py-2 text-sm">This device is kept for {{ id.locked.value.space_name }} ({{ id.locked.value.label }}): no other space opens here. Its administrator releases it in Preferences → Front desk.</p>
        <p v-if="!me.spaces.length" class="text-sm text-gray-600">No spaces on this site yet.</p>
        <ul v-else class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
          <li v-for="s in me.spaces" :key="`${s.edition}:${s.tenant_id}`" class="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <span class="min-w-0 flex-1">
              <span class="font-medium text-ink">{{ s.space_name }}</span> <span class="chip ml-1">{{ KIND[s.kind] }}</span>
              <span v-if="s.roles.length" class="block text-xs text-gray-500">{{ s.roles.join(", ") }}</span>
            </span>
            <span v-if="me.space?.tenant_id === s.tenant_id && s.edition === (me.space?.edition ?? '')" class="inline-flex items-center gap-1 text-sm text-success"><Check class="size-4" aria-hidden="true" /> Open</span>
            <button v-else-if="!id.locked.value" type="button" class="btn-light h-9 px-3 text-sm" :disabled="busy !== null" @click="run('space', () => id.openSpace(s.tenant_id, s.edition))">Open</button>
            <ConfirmAction label="Leave" :message="`Take “${s.space_name}” off your account? You can add it again as its member.`" trigger-class="btn-ghost h-9 px-2 text-sm" @confirm="run('leave', () => id.leaveSpace(s.tenant_id, s.edition))" />
          </li>
        </ul>
        <ul v-if="me.waiting?.length" class="space-y-1 text-sm text-gray-700">
          <li v-for="w in me.waiting" :key="w.space_name">Waiting for {{ w.space_name }}'s administrator to let you in. It appears here by itself once they do.</li>
        </ul>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-light h-9 px-3 text-sm" @click="guide"><Plus class="size-4" aria-hidden="true" /> Start or join a space</button>
          <button v-if="me.space && !id.locked.value" type="button" class="btn-ghost h-9 px-3 text-sm" @click="run('space', () => id.openSpace(null))">Close the space</button>
        </div>
        <details class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-700">
          <summary class="cursor-pointer text-ink">I already have a member key for this space</summary>
          <p class="mt-1">Sign in to this space with your member key (or as its administrator), then add it to your account, so you won't need the key again.</p>
          <button type="button" class="btn-light mt-2 h-9 px-3 text-sm" :disabled="busy !== null" @click="run('link', id.linkSpace)">Add this space to my account</button>
        </details>
      </section>

      <!-- Ways to sign in (IDN-40). -->
      <section class="space-y-2" aria-label="Ways to sign in">
        <h4 class="text-sm font-semibold text-ink">Ways to sign in</h4>
        <ul class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
          <li v-for="m in methods" :key="m.id" class="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <span class="min-w-0 flex-1"><span class="font-medium text-ink">{{ METHOD[m.kind] }}</span> <span class="text-sm text-gray-600">{{ m.display }}</span><span class="block text-xs text-gray-500">Last used {{ when(m.last_used_at) }}</span></span>
            <ConfirmAction v-if="methods.length > 1" label="Remove" :aria-label="`Remove ${m.display}`" :message="`Remove “${m.display}”? You won't be able to sign in with it.`" trigger-class="btn-ghost h-8 px-2 text-red-800" @confirm="run('rm', () => id.removeMethod(m.id))"><Trash2 class="size-4" aria-hidden="true" /></ConfirmAction>
          </li>
        </ul>
        <div class="flex flex-wrap gap-2">
          <button v-if="id.passkeys.value" type="button" class="btn-light h-9 px-3 text-sm" :disabled="busy !== null" @click="run('add', () => id.passkeyCreate({ label: 'Passkey' }), 'Passkey added.')"><KeyRound class="size-4" aria-hidden="true" /> Add a passkey</button>
          <button v-if="id.config.value?.google && !methods.some((m) => m.kind === 'oidc')" type="button" class="btn-light h-9 px-3 text-sm" @click="id.google()">Add Google</button>
        </div>
      </section>

      <!-- Recovery codes (IDN-21). -->
      <section class="space-y-2" aria-label="Recovery codes">
        <h4 class="text-sm font-semibold text-ink">Recovery codes</h4>
        <p class="text-sm text-gray-600">{{ recoveryLeft ? `${recoveryLeft} unused. Each signs you in once, if you lose your devices.` : "None yet. Make some and keep them somewhere safe, away from your phone." }}</p>
        <div v-if="codes" class="space-y-2 rounded-xl bg-mist p-3">
          <p class="text-sm text-ink">Write these down or save them now: they are shown only this once.</p>
          <ol class="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-ink @lg:grid-cols-5"><li v-for="c in codes" :key="c">{{ c }}</li></ol>
          <button type="button" class="btn-ghost h-8 px-2 text-sm" @click="copyCodes"><Copy class="size-4" aria-hidden="true" /> {{ copied ? "Copied" : "Copy" }}</button>
        </div>
        <button type="button" class="btn-light h-9 px-3 text-sm" :disabled="busy !== null" @click="makeCodes">{{ recoveryLeft ? "Make new codes (the old ones stop working)" : "Make recovery codes" }}</button>
      </section>

      <!-- A device asks to sign in with a code (IDN-41). -->
      <section class="space-y-2" aria-labelledby="approve-h">
        <h4 id="approve-h" class="text-sm font-semibold text-ink">Approve a device</h4>
        <p class="text-sm text-gray-600">A kiosk you scanned, a terminal (<code>yaxb login</code>), a box or a voice device shows a code. Type it here (a scan fills it in) to sign it in as you.</p>
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="lookUpDevice">
          <label class="block text-sm"><span class="mb-1 block font-medium text-ink">The code it shows</span><input v-model="deviceCode" class="input w-40 font-mono uppercase tracking-widest" maxlength="9" placeholder="ABCD-EFGH" autocomplete="off" /></label>
          <button type="submit" class="btn-light h-10 px-3 text-sm" :disabled="busy !== null || deviceCode.trim().length < 8">Look it up</button>
        </form>
        <div v-if="asking" class="space-y-2 rounded-xl bg-mist p-3 text-sm" role="group" aria-label="The device asking">
          <p v-if="asking.client === 'handoff'" class="text-ink">The kiosk you scanned asks to sign you in on it for 30 minutes. Only approve it if you are standing at it, just now.</p>
          <p v-else class="text-ink"><strong>{{ asking.name }}</strong>, {{ CLIENT_A[asking.client] ?? asking.client }}, asks to {{ asking.scopes.map((s) => SCOPE[s] ?? s).join(" and ") }}. Only approve it if you started it yourself, just now.</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-primary h-9 px-3 text-sm" :disabled="busy !== null" @click="answerDevice(true)">Approve</button>
            <button type="button" class="btn-ghost h-9 px-3 text-sm" :disabled="busy !== null" @click="answerDevice(false)">Turn it down</button>
          </div>
        </div>
      </section>

      <!-- Devices and sessions (IDN-40). -->
      <section v-if="sessions" class="space-y-2" aria-label="Devices">
        <h4 class="text-sm font-semibold text-ink">Signed in on</h4>
        <ul class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
          <li v-for="s in sessions.sessions" :key="s.id" class="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <MonitorSmartphone class="size-4 text-gray-400" aria-hidden="true" />
            <span class="min-w-0 flex-1 text-sm"><span class="text-ink">{{ s.device ?? "A device" }}</span><span class="block text-xs text-gray-500">{{ METHOD[s.method] }} · last used {{ when(s.last_used_at) }}</span></span>
            <span v-if="s.id === sessions.current" class="chip">This device</span>
            <button v-else type="button" class="btn-ghost h-8 px-2 text-sm" @click="run('end', async () => (await id.endSession(s.id), await loadSessions()))">Sign out</button>
          </li>
        </ul>
        <ul v-if="devices.length" class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100" aria-label="Devices signed in with a code">
          <li v-for="d in devices" :key="d.id" class="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <MonitorSmartphone class="size-4 text-gray-400" aria-hidden="true" />
            <span class="min-w-0 flex-1 text-sm"><span class="text-ink">{{ d.name }}</span><span class="block text-xs text-gray-500">{{ CLIENT[d.client] ?? d.client }} · signed in with a code · last used {{ when(d.last_used_at) }}</span></span>
            <ConfirmAction label="Sign out" :message="`Sign ${d.name} out for good? Only it stops working; sign it in again with a new code.`" trigger-class="btn-ghost h-8 px-2 text-sm" @confirm="run('device-out', async () => (await id.revokeDevice(d.id), (devices = await id.devices())))" />
          </li>
        </ul>
        <button v-if="sessions.sessions.length > 1" type="button" class="btn-ghost h-9 px-3 text-sm" @click="run('all', async () => (await id.signOut(true)))">Sign out everywhere</button>
      </section>

      <section class="border-t border-gray-100 pt-3" aria-label="Delete">
        <ConfirmAction
          label="Delete my account"
          confirm-label="Delete it"
          message="Delete your account? Your ways to sign in, your sessions and your spaces on it go. Your profile on this device stays. This can't be undone."
          trigger-class="btn-ghost text-red-800"
          @confirm="run('delete', id.deleteAccount, 'Your account is deleted.')"
        />
      </section>
    </template>

    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{{ notice }}</p>
  </div>
</template>
