<script setup lang="ts">
// Administration (MOD-20..23, MOD-25, TEAM-1..6): sign in with the administrator token (or as a
// member with the administrator role), then invite members (their key is shown once), change their
// roles, suspend, reinstate or remove them, and read the audit log.
import { AUDIT_ACTIONS, MODERATOR_ROLES, type AuditEvent, type Moderator, type ModeratorStatus } from "@sekaran-ind/yaxb-core/moderators";
import { memberStatus, type MemberStatus } from "@sekaran-ind/yaxb-core/team";
import { Copy, KeyRound, Lock, LogOut, Pencil, RefreshCw, RotateCw, ShieldAlert, Trash2, UserPlus } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { roleCatalogue, roleName, loadLibraryContent } from "@/composables/library";
import { cn } from "@/lib/cn";

type Row = Moderator & { status: ModeratorStatus };
const admin = ref<{ admin: boolean; enabled: boolean } | null>(null);
const token = ref("");
const error = ref<string | null>(null);
const busy = ref(false);
const rows = ref<Row[]>([]);
const audit = ref<AuditEvent[]>([]);
const form = ref<{ name: string; label: string; roles: string[]; expiresInDays: number | null } | null>(null);
/** A key just issued or rotated: shown once, until dismissed. */
const shownKey = ref<{ name: string; key: string } | null>(null);
const copied = ref(false);

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status}).`);
  return body as T;
}
/** Built-in member roles and the organisation's own (Journey library, Roles). */
const roleOptions = computed(() => [...new Set<string>([...MODERATOR_ROLES, ...roleCatalogue.value.map((r) => r.id)])]);
onMounted(() => void loadLibraryContent());

async function load() {
  error.value = null;
  try {
    admin.value = await api("/api/admin");
    if (!admin.value?.admin) return;
    rows.value = (await api<{ moderators: Row[] }>("/api/admin/moderators")).moderators;
    audit.value = (await api<{ events: AuditEvent[] }>("/api/admin/audit")).events;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function act(work: () => Promise<unknown>) {
  busy.value = true;
  error.value = null;
  try {
    await work();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const signIn = () =>
  act(async () => {
    await api("/api/admin", { method: "POST", body: JSON.stringify({ token: token.value }) });
    token.value = "";
  });
const signOut = () => act(() => api("/api/admin", { method: "DELETE" }));
const issue = () =>
  act(async () => {
    if (!form.value) return;
    const { name, label, roles, expiresInDays } = form.value;
    const r = await api<{ moderator: Row; key: string }>("/api/admin/moderators", { method: "POST", body: JSON.stringify({ name, ...(label.trim() ? { label } : {}), roles, ...(expiresInDays ? { expiresInDays } : {}) }) });
    shownKey.value = { name: r.moderator.name, key: r.key };
    form.value = null;
  });
const revoke = (m: Row) => confirm(`Suspend ${m.name}? Their key stops working and they are signed out at once.`) && act(() => api(`/api/admin/moderators/${m.id}/revoke`, { method: "POST" }));
const remove = (m: Row) => confirm(`Remove ${m.name} from the team? Their key and profile are deleted; the audit log keeps the history.`) && act(() => api(`/api/admin/moderators/${m.id}`, { method: "DELETE" }));
/** Editing a member's roles inline. */
const editing = ref<{ id: string; roles: string[] } | null>(null);
const saveRoles = () =>
  act(async () => {
    if (!editing.value) return;
    await api(`/api/admin/moderators/${editing.value.id}`, { method: "PATCH", body: JSON.stringify({ roles: editing.value.roles }) });
    editing.value = null;
  });
const rotate = (m: Row) =>
  confirm(`Give ${m.name} a new key? The old one stops working at once.`) &&
  act(async () => {
    const r = await api<{ moderator: Row; key: string }>(`/api/admin/moderators/${m.id}/rotate`, { method: "POST" });
    shownKey.value = { name: r.moderator.name, key: r.key };
  });
async function copyKey() {
  if (!shownKey.value) return;
  await navigator.clipboard.writeText(shownKey.value.key).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const STATUS_CLASS: Record<MemberStatus, string> = { active: "bg-success/10 text-ink", invited: "bg-info/10 text-ink", suspended: "bg-danger/10 text-red-800", expired: "bg-warning/20 text-ink" };
const detailText = (d: AuditEvent["details"]) => (d ? Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(" · ") : "");
onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" role="alert" class="rounded-md bg-danger/10 px-4 py-3 text-sm text-red-800">{{ error }}</p>

    <section v-if="admin && !admin.enabled" class="card p-5 text-sm text-gray-600">
      Administration isn't enabled on this site. Set the <code>ADMIN_TOKEN</code> secret (locally in <code>apps/web/.dev.vars</code>) to issue moderator keys.
    </section>

    <form v-else-if="admin && !admin.admin" class="card flex flex-wrap items-center gap-2 p-5 text-sm" @submit.prevent="signIn">
      <Lock class="size-4 text-gray-500" aria-hidden="true" />
      <label for="admin-token">Administrator token</label>
      <input id="admin-token" v-model="token" type="password" autocomplete="current-password" required class="input max-w-xs" />
      <button type="submit" class="btn-primary" :disabled="busy">Sign in</button>
    </form>

    <template v-else-if="admin?.admin">
      <!-- A key is shown once: copy it now and give it to the moderator. -->
      <section v-if="shownKey" class="card space-y-3 border-l-4 border-warning p-5" role="alert">
        <h3 class="flex items-center gap-2 font-semibold text-ink"><KeyRound class="size-4" aria-hidden="true" /> {{ shownKey.name }}'s key</h3>
        <p class="text-sm text-gray-600">Copy it now and give it to {{ shownKey.name }} privately. It won't be shown again; if it's lost, rotate it.</p>
        <code class="block rounded bg-mist px-3 py-2 text-sm break-all text-ink">{{ shownKey.key }}</code>
        <div class="flex gap-2">
          <button type="button" class="btn-light" @click="copyKey"><Copy class="size-4" aria-hidden="true" /> {{ copied ? "Copied" : "Copy" }}</button>
          <button type="button" class="btn-primary" @click="shownKey = null">I've saved it</button>
        </div>
      </section>

      <section class="card p-5">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold text-ink">Team</h3>
          <div class="flex gap-2">
            <button type="button" class="btn-light" @click="form = { name: '', label: '', roles: ['moderator'], expiresInDays: null }"><UserPlus class="size-4" aria-hidden="true" /> Invite member</button>
            <button type="button" class="btn-light" aria-label="Refresh" @click="load"><RefreshCw class="size-4" aria-hidden="true" /></button>
            <button type="button" class="btn-light" @click="signOut"><LogOut class="size-4" aria-hidden="true" /> Sign out</button>
          </div>
        </div>

        <form v-if="form" class="mb-4 grid gap-3 rounded-lg bg-mist p-4 @lg:grid-cols-2" @submit.prevent="issue">
          <div><label for="m-name" class="mb-1 block text-sm font-medium text-ink">Name</label><input id="m-name" v-model="form.name" class="input" required maxlength="80" /></div>
          <div><label for="m-label" class="mb-1 block text-sm font-medium text-ink">Label <span class="font-normal text-gray-500">(optional)</span></label><input id="m-label" v-model="form.label" class="input" maxlength="80" placeholder="e.g. Pharmacy team" /></div>
          <fieldset>
            <legend class="mb-1 text-sm font-medium text-ink">Roles</legend>
            <label v-for="r in roleOptions" :key="r" class="mr-4 inline-flex items-center gap-1.5 text-sm"><input v-model="form.roles" type="checkbox" :value="r" class="size-4 accent-brand" />{{ roleName(r) }}</label>
          </fieldset>
          <div>
            <label for="m-exp" class="mb-1 block text-sm font-medium text-ink">Key expires after</label>
            <select id="m-exp" v-model="form.expiresInDays" class="input">
              <option :value="null">Never</option>
              <option :value="30">30 days</option>
              <option :value="90">90 days</option>
              <option :value="180">180 days</option>
              <option :value="365">1 year</option>
            </select>
          </div>
          <div class="flex justify-end gap-2 @lg:col-span-2">
            <button type="button" class="btn-light" @click="form = null">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="busy || !form.name.trim() || !form.roles.length">Issue key</button>
          </div>
        </form>

        <p v-if="!rows.length" class="text-sm text-gray-500">No members yet. Invite one to issue their key.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead class="text-xs text-gray-500">
              <tr><th class="py-1.5 font-normal">Name</th><th class="font-normal">Roles</th><th class="font-normal">Status</th><th class="font-normal">Key</th><th class="font-normal">Last sign-in</th><th class="font-normal">Reviews</th><th class="sr-only">Actions</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in rows" :key="m.id" class="border-t border-gray-100">
                <td class="py-2 pr-3"><span class="font-medium text-ink">{{ m.name }}</span><span v-if="m.label" class="block text-xs text-gray-500">{{ m.label }}</span></td>
                <td class="pr-3">
                  <form v-if="editing?.id === m.id" class="flex flex-wrap items-center gap-2" @submit.prevent="saveRoles">
                    <label v-for="r in roleOptions" :key="r" class="inline-flex items-center gap-1 text-xs"><input v-model="editing.roles" type="checkbox" :value="r" class="size-3.5 accent-brand" />{{ roleName(r) }}</label>
                    <button type="submit" class="btn-primary h-7 px-2.5 text-xs" :disabled="busy || !editing.roles.length">Save</button>
                    <button type="button" class="btn-ghost h-7 px-2 text-xs" @click="editing = null">Cancel</button>
                  </form>
                  <button v-else type="button" class="group inline-flex items-center gap-1 capitalize hover:text-ink" :title="`Change ${m.name}'s roles`" @click="editing = { id: m.id, roles: [...m.roles] }">
                    {{ m.roles.map(roleName).join(", ") }} <Pencil class="size-3 opacity-0 group-hover:opacity-60" aria-hidden="true" />
                  </button>
                </td>
                <td class="pr-3">
                  <span :class="cn('rounded-full px-2 py-0.5 text-xs capitalize', STATUS_CLASS[memberStatus(m)])">{{ memberStatus(m) }}</span>
                  <span v-if="m.expires_at && m.status === 'active'" class="block text-xs text-gray-500">until {{ new Date(m.expires_at).toLocaleDateString() }}</span>
                </td>
                <td class="pr-3 font-mono text-xs text-gray-600">{{ m.key_prefix }}</td>
                <td class="pr-3 text-xs text-gray-600">{{ when(m.last_seen_at) }}</td>
                <td class="pr-3">{{ m.reviews }}</td>
                <td class="text-right whitespace-nowrap">
                  <button type="button" class="rounded p-1.5 text-gray-600 hover:bg-mist" :aria-label="m.status === 'revoked' ? `Reinstate ${m.name} with a new key` : `Rotate ${m.name}'s key`" :title="m.status === 'revoked' ? 'Reinstate (new key)' : 'Rotate key'" :disabled="busy" @click="rotate(m)"><RotateCw class="size-4" /></button>
                  <button v-if="m.status !== 'revoked'" type="button" class="rounded p-1.5 text-red-700 hover:bg-danger/10" :aria-label="`Suspend ${m.name}`" title="Suspend" :disabled="busy" @click="revoke(m)"><ShieldAlert class="size-4" /></button>
                  <button type="button" class="rounded p-1.5 text-red-700 hover:bg-danger/10" :aria-label="`Remove ${m.name}`" title="Remove from the team" :disabled="busy" @click="remove(m)"><Trash2 class="size-4" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card p-5">
        <h3 class="font-semibold text-ink">Audit log</h3>
        <p class="mt-1 mb-3 text-sm text-gray-500">Who did what and when. It never records what was reviewed or asked.</p>
        <p v-if="!audit.length" class="text-sm text-gray-500">Nothing yet.</p>
        <ol v-else class="divide-y divide-gray-100 text-sm">
          <li v-for="e in audit" :key="e.id" class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
            <span class="text-ink">
              {{ AUDIT_ACTIONS[e.action] ?? e.action }}<span v-if="e.actor_name" class="text-gray-500"> · {{ e.actor_name }}</span>
              <span v-if="e.details" class="block text-xs text-gray-500">{{ detailText(e.details) }}</span>
            </span>
            <time :datetime="e.at" class="text-xs text-gray-500">{{ new Date(e.at).toLocaleString() }}</time>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>
