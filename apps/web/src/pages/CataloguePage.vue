<script setup lang="ts">
// The Service Catalogue (LIB-14..20), a page of the portal, outside the kiosk. Anyone designs
// services here: a service holds journeys, a journey holds screens, and the service's roles say who
// starts and finishes each journey. Reviewers publish them, and kiosks load published services.
//   Catalogue      published services, to open or load into a kiosk
//   My services    a guest's own (members: every service)
//   Review         what is waiting for a reviewer
//   Roles          the built-in roles, the organisation's, and those services define
//   Libraries      how members organise services
// Place in the page is in the address: ?view=…&service=<id>|new.
import type { Library, LibraryEntry, LibraryPermissions } from "@sekaran-ind/yaxb-core/library";
import { roleLabel, type Role } from "@sekaran-ind/yaxb-journeys";
import { provideIcons } from "@sekaran-ind/yaxb-journeys/vue";
import "@sekaran-ind/yaxb-journeys/style.css";
import { Archive, ArchiveRestore, ExternalLink, FolderPlus, LogOut, Pencil, Plus, Trash2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import EntryStatus from "@/components/catalogue/EntryStatus.vue";
import ServiceWorkspace from "@/components/catalogue/ServiceWorkspace.vue";
import ModeratorSignIn from "@/components/moderation/ModeratorSignIn.vue";
import { catalogue, loadCatalogue, roleCatalogue, type CatalogueService } from "@/composables/library";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { iconFor } from "@/lib/icons";

provideIcons(iconFor);

type LibraryRow = Library & { counts: Record<"total" | "draft" | "in_review" | "accepted" | "rejected" | "archived", number> };
type Overview = {
  me: { id: string; name: string; roles: string[]; admin: boolean; guest: boolean; can: LibraryPermissions };
  roles: Role[];
  libraries: LibraryRow[];
  services: LibraryEntry[];
  queue: LibraryEntry[];
};

const route = useRoute();
const router = useRouter();
const overview = ref<Overview | null>(null);
const error = ref<string | null>(null);
const signingIn = ref(false);

const q = (k: string) => (typeof route.query[k] === "string" ? (route.query[k] as string) : null);
const service = computed(() => q("service"));
const VIEWS = ["catalogue", "mine", "review", "roles", "libraries"] as const;
type View = (typeof VIEWS)[number];
const view = computed<View>(() => ((VIEWS as readonly string[]).includes(q("view") ?? "") ? (q("view") as View) : "catalogue"));
function go(patch: Record<string, string | null>) {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) if (typeof v === "string") query[k] = v;
  void router.push({ path: "/catalogue", query });
}

async function load() {
  error.value = null;
  try {
    overview.value = await api<Overview>("/api/library");
  } catch (e) {
    error.value = (e as Error).message;
  }
  void loadCatalogue();
}
void load();
const changed = () => void load();

const me = computed(() => overview.value?.me);
const can = computed(() => me.value?.can);
async function signOut() {
  await api("/api/moderator", undefined, "DELETE").catch(() => undefined);
  await load();
}

// ---- lists ----------------------------------------------------------------------------------
const libraryFilter = ref("");
const statusFilter = ref("");
const services = computed(() =>
  (overview.value?.services ?? []).filter((s) => (!libraryFilter.value || s.library_id === libraryFilter.value) && (statusFilter.value ? s.status === statusFilter.value : s.status !== "archived")),
);
const libraryName = (id: string) => overview.value?.libraries.find((l) => l.id === id)?.name ?? "";
const published = (entryId: string) => catalogue.value.find((s) => s.entry_id === entryId) ?? null;
const kioskLink = (s: CatalogueService) => `/kiosk?screen=services&load=${encodeURIComponent(s.entry_id)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");
const tabs = computed(() => [
  { id: "catalogue", label: `Catalogue (${catalogue.value.length})` },
  { id: "mine", label: me.value?.can.view ? "All services" : "My services" },
  ...(can.value?.view ? [{ id: "review", label: `Review${overview.value?.queue.length ? ` (${overview.value.queue.length})` : ""}` }] : []),
  { id: "roles", label: "Roles" },
  ...(can.value?.view ? [{ id: "libraries", label: "Libraries" }] : []),
]);

// ---- roles ----------------------------------------------------------------------------------
/** Every role: built in, the organisation's, and those services define (from the catalogue). */
const allRoles = computed(() => {
  const org = overview.value?.roles ?? [];
  const fromServices = roleCatalogue.value.filter((r) => !org.some((o) => o.id === r.id));
  return [...org.map((r) => ({ ...r, source: r.builtin ? "Built in" : "Organisation" })), ...fromServices.map((r) => ({ ...r, source: "Defined by a service" }))];
});
const usedBy = (id: string) => catalogue.value.filter((s) => s.roles.some((r) => r.id === id) || s.journeys.some((j) => j.initiate.includes(id) || j.complete.includes(id))).map((s) => s.title);
const newRole = ref<{ label: string; description: string } | null>(null);
const roleError = ref<string | null>(null);
const roleId = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+|-+$/g, "").slice(0, 32);
async function addRole() {
  if (!newRole.value) return;
  roleError.value = null;
  try {
    await api("/api/library/roles", { id: roleId(newRole.value.label), label: newRole.value.label, ...(newRole.value.description.trim() ? { description: newRole.value.description } : {}) });
    newRole.value = null;
    await load();
  } catch (e) {
    roleError.value = (e as Error).message;
  }
}
async function removeRole(id: string) {
  if (!window.confirm(`Remove the role "${roleLabel(id, allRoles.value)}"?`)) return;
  roleError.value = null;
  try {
    await api(`/api/library/roles/${id}`, undefined, "DELETE");
    await load();
  } catch (e) {
    roleError.value = (e as Error).message;
  }
}

// ---- libraries ------------------------------------------------------------------------------
const newLib = ref<{ name: string; description: string } | null>(null);
const editLib = ref<{ id: string; name: string; description: string } | null>(null);
const libError = ref<string | null>(null);
async function libCall(fn: () => Promise<unknown>) {
  libError.value = null;
  try {
    await fn();
    newLib.value = editLib.value = null;
    await load();
  } catch (e) {
    libError.value = (e as Error).message;
  }
}

// After signing in, the overview changes (who you are, what you see).
watch(signingIn, (v) => !v && void load());
</script>

<template>
  <section class="bg-canvas py-8 md:py-12">
    <div class="mx-auto max-w-[1440px] px-4 sm:px-6">
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div class="max-w-3xl">
          <h1 class="text-2xl font-semibold tracking-[-0.03em] text-ink md:text-3xl">Service catalogue</h1>
          <p class="mt-2 text-pretty">Design a service: its journeys, the screens of each journey, and the roles that start and finish them. A reviewer publishes it, and any kiosk can load it.</p>
        </div>
        <div v-if="me" class="text-right text-sm">
          <template v-if="me.guest">
            <p class="text-gray-600">Designing as a guest</p>
            <button type="button" class="font-medium text-ink hover:underline" @click="signingIn = !signingIn">Staff? Sign in</button>
          </template>
          <template v-else>
            <p class="text-ink">{{ me.name }}</p>
            <p class="text-xs text-gray-500">
              {{ me.roles.map((r) => roleLabel(r, allRoles)).join(", ") }}
              <button v-if="!me.admin" type="button" class="ml-1 inline-flex items-center gap-1 align-middle text-gray-500 hover:text-ink" @click="signOut"><LogOut class="size-3.5" aria-hidden="true" /> Sign out</button>
            </p>
          </template>
        </div>
      </header>
      <ModeratorSignIn v-if="signingIn" class="mb-4" why="Sign in with your moderator key to see every service, review and manage roles." @signed-in="signingIn = false" />
      <p v-if="error" role="alert" class="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>

      <template v-if="overview && me && can">
        <ServiceWorkspace
          v-if="service"
          :key="service"
          :entry-id="service === 'new' ? null : service"
          :me="me"
          :roles="overview.roles"
          :libraries="overview.libraries"
          :published="service === 'new' ? null : published(service)"
          @close="go({ service: null })"
          @created="(id) => (changed(), go({ service: id }))"
          @changed="changed"
        />

        <template v-else>
          <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap gap-0.5 rounded-full bg-mist p-0.5" role="tablist" aria-label="Service catalogue">
              <button
                v-for="t in tabs"
                :key="t.id"
                type="button"
                role="tab"
                :aria-selected="view === t.id"
                :class="cn('rounded-full px-3.5 py-1.5 text-sm font-medium', view === t.id ? 'bg-surface text-ink shadow-sm' : 'text-gray-500 hover:text-ink')"
                @click="go({ view: t.id === 'catalogue' ? null : t.id })"
              >
                {{ t.label }}
              </button>
            </div>
            <button type="button" class="btn-primary" @click="go({ service: 'new' })"><Plus class="size-4" aria-hidden="true" /> New service</button>
          </div>

          <!-- Published services -->
          <section v-if="view === 'catalogue'" aria-label="Published services">
            <p v-if="!catalogue.length" class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">Nothing is published yet. Design a service and send it for review.</p>
            <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <li v-for="s in catalogue" :key="s.entry_id" class="card flex flex-col gap-2 p-4">
                <div class="flex items-start gap-3">
                  <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-mist text-ink"><component :is="iconFor(s.icon ?? undefined)" v-if="iconFor(s.icon ?? undefined)" class="size-5" aria-hidden="true" /></span>
                  <span class="min-w-0">
                    <span class="block font-semibold text-ink">{{ s.title }}</span>
                    <span class="block text-xs text-gray-500">{{ s.library }} · revision {{ s.revision }} · {{ when(s.published_at) }}</span>
                  </span>
                </div>
                <p v-if="s.summary" class="text-sm text-gray-600">{{ s.summary }}</p>
                <p class="text-xs text-gray-500">
                  {{ s.journeys.length }} journey{{ s.journeys.length === 1 ? "" : "s" }}: {{ s.journeys.map((j) => j.title).join(", ") }}
                </p>
                <p v-if="s.roles.length" class="flex flex-wrap gap-1"><span v-for="r in s.roles" :key="r.id" class="chip">{{ r.label }}</span></p>
                <div class="mt-auto flex flex-wrap gap-2 pt-2">
                  <button type="button" class="btn-light h-9 text-sm" @click="go({ service: s.entry_id })">Open</button>
                  <a :href="kioskLink(s)" class="btn-ghost h-9 text-sm"><ExternalLink class="size-4" aria-hidden="true" /> Open in a kiosk</a>
                </div>
              </li>
            </ul>
          </section>

          <!-- My services / all services -->
          <section v-else-if="view === 'mine'" aria-label="Services" class="space-y-3">
            <p v-if="me.guest" class="text-sm text-gray-600">The services you designed in this browser. Sign in as a team member to keep them with your key instead.</p>
            <div class="flex flex-wrap gap-2">
              <select v-if="can.view" v-model="libraryFilter" class="input w-auto" aria-label="Library">
                <option value="">Every library</option>
                <option v-for="l in overview.libraries" :key="l.id" :value="l.id">{{ l.name }}</option>
              </select>
              <select v-model="statusFilter" class="input w-auto" aria-label="Status">
                <option value="">Not archived</option>
                <option value="draft">Drafts</option>
                <option value="in_review">In review</option>
                <option value="accepted">Published</option>
                <option value="rejected">Rejected</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <p v-if="!services.length" class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">No services here yet.</p>
            <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <li v-for="s in services" :key="s.id">
                <button type="button" class="card flex w-full flex-col items-start gap-1 p-4 text-left hover:border-gray-300" @click="go({ service: s.id })">
                  <span class="flex w-full items-start justify-between gap-2"><span class="font-semibold text-ink">{{ s.title }}</span><EntryStatus :status="s.status" /></span>
                  <span class="text-xs text-gray-500">{{ s.doc_id }} · {{ libraryName(s.library_id) }} · revision {{ s.revision }}</span>
                  <span class="text-xs text-gray-500">By {{ s.owner_name }} · saved {{ when(s.updated_at) }}</span>
                </button>
              </li>
            </ul>
          </section>

          <!-- Review queue -->
          <section v-else-if="view === 'review'" aria-label="Waiting for review" class="space-y-3">
            <p class="text-sm text-gray-600">Open each service, read its summary and try it in the preview, then accept it (kiosks can load it) or reject it with a note. Nobody reviews their own.</p>
            <p v-if="!overview.queue.length" class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">Nothing is waiting for review.</p>
            <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <li v-for="s in overview.queue" :key="s.id">
                <button type="button" class="card flex w-full flex-col items-start gap-1 p-4 text-left hover:border-gray-300" @click="go({ service: s.id })">
                  <span class="font-semibold text-ink">{{ s.title }}</span>
                  <span class="text-xs text-gray-500">Revision {{ s.revision }} from {{ s.submitted_by_name }}, {{ when(s.submitted_at) }} · {{ libraryName(s.library_id) }}</span>
                </button>
              </li>
            </ul>
          </section>

          <!-- Roles -->
          <section v-else-if="view === 'roles'" aria-label="Roles" class="max-w-4xl space-y-3">
            <p class="text-sm text-gray-600">
              Each service defines the roles that deliver it, in the designer's side panel. Admin, Moderator and Reviewer are built in; administrators can add roles for the whole organisation. Team members get roles under
              Administration in the kiosk, and a kiosk offers a journey to the roles that start it.
            </p>
            <p v-if="roleError" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ roleError }}</p>
            <ul class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
              <li v-for="r in allRoles" :key="r.id" class="flex flex-wrap items-center gap-2 px-4 py-3">
                <span class="min-w-0 flex-1">
                  <span class="font-medium text-ink">{{ r.label }}</span> <code class="text-xs text-gray-500">{{ r.id }}</code> <span class="chip ml-1">{{ r.source }}</span>
                  <span v-if="r.description" class="block text-xs text-gray-500">{{ r.description }}</span>
                  <span v-if="usedBy(r.id).length" class="block text-xs text-gray-500">Used by {{ usedBy(r.id).join(", ") }}</span>
                </span>
                <button v-if="can.manage && r.source === 'Organisation'" type="button" class="btn-ghost h-8 px-2 text-red-800" :aria-label="`Remove ${r.label}`" @click="removeRole(r.id)"><Trash2 class="size-4" aria-hidden="true" /></button>
              </li>
            </ul>
            <template v-if="can.manage">
              <form v-if="newRole" class="card grid gap-2 p-3 sm:grid-cols-2" @submit.prevent="addRole">
                <label class="text-sm"><span class="mb-1 block text-gray-600">Name</span><input v-model="newRole.label" class="input" required maxlength="40" placeholder="Front desk" /></label>
                <label class="text-sm"><span class="mb-1 block text-gray-600">What they do</span><input v-model="newRole.description" class="input" maxlength="200" /></label>
                <div class="flex gap-2 sm:col-span-2">
                  <button type="submit" class="btn-primary">Add role</button>
                  <button type="button" class="btn-ghost" @click="newRole = null">Cancel</button>
                </div>
              </form>
              <button v-else type="button" class="btn-light" @click="newRole = { label: '', description: '' }"><Plus class="size-4" aria-hidden="true" /> Add an organisation role</button>
            </template>
          </section>

          <!-- Libraries -->
          <section v-else-if="view === 'libraries'" aria-label="Libraries" class="max-w-4xl space-y-3">
            <p class="text-sm text-gray-600">Libraries group services. A guest's services go to the default library; members choose one when they create a service.</p>
            <p v-if="libError" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ libError }}</p>
            <ul class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
              <li v-for="l in overview.libraries" :key="l.id" class="flex flex-wrap items-center gap-2 px-4 py-3">
                <form v-if="editLib?.id === l.id" class="flex flex-1 flex-wrap gap-2" @submit.prevent="libCall(() => api(`/api/library/libraries/${l.id}`, { name: editLib!.name, description: editLib!.description }, 'PATCH'))">
                  <input v-model="editLib.name" class="input max-w-64" aria-label="Library name" required />
                  <input v-model="editLib.description" class="input min-w-48 flex-1" aria-label="Description" />
                  <button type="submit" class="btn-primary h-9">Save</button>
                  <button type="button" class="btn-ghost h-9" @click="editLib = null">Cancel</button>
                </form>
                <template v-else>
                  <span class="min-w-0 flex-1">
                    <span class="font-medium text-ink">{{ l.name }}</span><span v-if="l.status === 'archived'" class="chip ml-2">Archived</span>
                    <span class="block text-xs text-gray-500">{{ l.counts.total }} services · {{ l.counts.accepted }} published · {{ l.counts.in_review }} in review</span>
                  </span>
                  <button v-if="can.edit" type="button" class="btn-ghost h-8 px-2" :aria-label="`Rename ${l.name}`" @click="editLib = { id: l.id, name: l.name, description: l.description ?? '' }"><Pencil class="size-4" aria-hidden="true" /></button>
                  <template v-if="can.manage">
                    <button v-if="l.status === 'active'" type="button" class="btn-ghost h-8 px-2" :aria-label="`Archive ${l.name}`" @click="libCall(() => api(`/api/library/libraries/${l.id}/archive`, {}))"><Archive class="size-4" aria-hidden="true" /></button>
                    <button v-else type="button" class="btn-ghost h-8 px-2" :aria-label="`Restore ${l.name}`" @click="libCall(() => api(`/api/library/libraries/${l.id}/restore`, {}))"><ArchiveRestore class="size-4" aria-hidden="true" /></button>
                  </template>
                </template>
              </li>
            </ul>
            <template v-if="can.edit">
              <form v-if="newLib" class="card grid gap-2 p-3 sm:grid-cols-2" @submit.prevent="libCall(() => api('/api/library/libraries', { name: newLib!.name, ...(newLib!.description.trim() ? { description: newLib!.description } : {}) }))">
                <label class="text-sm"><span class="mb-1 block text-gray-600">Name</span><input v-model="newLib.name" class="input" required maxlength="80" /></label>
                <label class="text-sm"><span class="mb-1 block text-gray-600">Description</span><input v-model="newLib.description" class="input" maxlength="400" /></label>
                <div class="flex gap-2 sm:col-span-2">
                  <button type="submit" class="btn-primary">Create library</button>
                  <button type="button" class="btn-ghost" @click="newLib = null">Cancel</button>
                </div>
              </form>
              <button v-else type="button" class="btn-light" @click="newLib = { name: '', description: '' }"><FolderPlus class="size-4" aria-hidden="true" /> New library</button>
            </template>
          </section>
        </template>
      </template>
    </div>
  </section>
</template>
