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
import { AdaptiveNav, ConfirmAction, type NavScreen } from "@sekaran-ind/yaxb-journeys/vue";
import { Archive, ArchiveRestore, ExternalLink, FolderPlus, Pencil, Plus, Trash2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { resolveLayout } from "@sekaran-ind/yaxb-core/screens";
import CatalogueInfo from "@/components/catalogue/CatalogueInfo.vue";
import KioskFrame from "@/components/site/KioskFrame.vue";
import EntryStatus from "@/components/catalogue/EntryStatus.vue";
import { useWidth } from "@/composables/width";
import ServiceWorkspace from "@/components/catalogue/ServiceWorkspace.vue";
import ModeratorSignIn from "@/components/moderation/ModeratorSignIn.vue";
import { catalogue, loadCatalogue, roleCatalogue, type CatalogueService } from "@/composables/library";
import { api } from "@/lib/api";
import { iconFor } from "@/lib/icons";

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

// ---- the frame ------------------------------------------------------------------------------
// The kiosk's frame and layouts (Full, Pod, Mini by the width), always chosen by the width here:
// the kiosk's own layout choice is a kiosk preference.
const { el: root, width } = useWidth(1280);
const layout = computed(() => resolveLayout(width.value, "auto"));
const infoVariant = computed(() => (layout.value === "full" ? "full" : layout.value === "pod" ? "strip" : "mini"));
const navScreens = computed<NavScreen[]>(() => [
  { id: "catalogue", label: "Catalogue", icon: "library", badge: String(catalogue.value.length) },
  { id: "mine", label: me.value?.can.view ? "All services" : "My services", icon: "clipboard-list", badge: String(overview.value?.services.length ?? 0) },
  ...(can.value?.view ? [{ id: "review", label: "Review", icon: "message-square", badge: overview.value?.queue.length ? String(overview.value.queue.length) : undefined }] : []),
  { id: "roles", label: "Roles", icon: "user-round" },
  ...(can.value?.view ? [{ id: "libraries", label: "Libraries", icon: "notebook" }] : []),
]);
const who = computed(() => (me.value ? { name: me.value.name, guest: me.value.guest, roles: me.value.roles.map((r) => roleLabel(r, allRoles.value)).join(", ") } : null));
const counts = computed(() => ({ published: catalogue.value.length, mine: overview.value?.services.length ?? 0, review: can.value?.view ? (overview.value?.queue.length ?? 0) : null }));
const STATUS: Record<string, string> = { draft: "Draft", in_review: "In review", accepted: "Published", rejected: "Rejected", archived: "Archived" };
const current = computed(() => {
  if (!service.value) return null;
  if (service.value === "new") return { title: "A new service", status: "Not saved yet" };
  const e = overview.value?.services.find((x) => x.id === service.value);
  if (e) return { title: e.title, status: `${STATUS[e.status]} · revision ${e.revision}` };
  const p = published(service.value);
  return p ? { title: p.title, status: "Published · read-only" } : null;
});

// After signing in, the overview changes (who you are, what you see).
watch(signingIn, (v) => !v && void load());
</script>

<template>
  <!-- The catalogue as a kiosk: the same frame, with an information panel where the kiosk has its player, and the catalogue's screens. -->
  <div ref="root" class="w-full">
    <KioskFrame :layout="layout" :narrow-panel="Boolean(service)">
      <template #panel>
        <CatalogueInfo :variant="infoVariant" :who="who" :counts="counts" :current="current" @new-service="go({ service: 'new' })" @sign-in="signingIn = true" @sign-out="signOut" />
      </template>
      <template #default="{ width: paneWidth }">
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
          <AdaptiveNav v-else :screens="navScreens" storage-key="catalogue" label="Catalogue screens" :active="view" :width="paneWidth" :fill="layout === 'full'" @update:active="(v) => go({ view: v === 'catalogue' ? null : v })">
            <template #catalogue>
              <section aria-label="Published services">
            <p v-if="!catalogue.length" class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">Nothing is published yet. Design a service and send it for review.</p>
            <ul class="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
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
            </template>
            <template #mine>
              <section aria-label="Services" class="space-y-3">
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
            <ul class="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
              <li v-for="s in services" :key="s.id">
                <button type="button" class="card flex w-full flex-col items-start gap-1 p-4 text-left hover:border-gray-300" @click="go({ service: s.id })">
                  <span class="flex w-full items-start justify-between gap-2"><span class="font-semibold text-ink">{{ s.title }}</span><EntryStatus :status="s.status" /></span>
                  <span class="text-xs text-gray-500">{{ s.doc_id }} · {{ libraryName(s.library_id) }} · revision {{ s.revision }}</span>
                  <span class="text-xs text-gray-500">By {{ s.owner_name }} · saved {{ when(s.updated_at) }}</span>
                </button>
              </li>
            </ul>
          </section>
            </template>
            <template #review>
              <section aria-label="Waiting for review" class="space-y-3">
            <p class="text-sm text-gray-600">Open each service, read its summary and try it in the preview, then accept it (kiosks can load it) or reject it with a note. Nobody reviews their own.</p>
            <p v-if="!overview.queue.length" class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">Nothing is waiting for review.</p>
            <ul class="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
              <li v-for="s in overview.queue" :key="s.id">
                <button type="button" class="card flex w-full flex-col items-start gap-1 p-4 text-left hover:border-gray-300" @click="go({ service: s.id })">
                  <span class="font-semibold text-ink">{{ s.title }}</span>
                  <span class="text-xs text-gray-500">Revision {{ s.revision }} from {{ s.submitted_by_name }}, {{ when(s.submitted_at) }} · {{ libraryName(s.library_id) }}</span>
                </button>
              </li>
            </ul>
          </section>
            </template>
            <template #roles>
              <section aria-label="Roles" class="max-w-4xl space-y-3">
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
                <ConfirmAction
                  v-if="can.manage && r.source === 'Organisation'"
                  label="Remove"
                  :aria-label="`Remove ${r.label}`"
                  :message="`Remove the role “${r.label}” from the organisation?`"
                  trigger-class="btn-ghost h-8 px-2 text-red-800"
                  @confirm="removeRole(r.id)"
                  ><Trash2 class="size-4" aria-hidden="true"
                /></ConfirmAction>
              </li>
            </ul>
            <template v-if="can.manage">
              <form v-if="newRole" class="card grid gap-2 p-3 @lg:grid-cols-2" @submit.prevent="addRole">
                <label class="text-sm"><span class="mb-1 block text-gray-600">Name</span><input v-model="newRole.label" class="input" required maxlength="40" placeholder="Front desk" /></label>
                <label class="text-sm"><span class="mb-1 block text-gray-600">What they do</span><input v-model="newRole.description" class="input" maxlength="200" /></label>
                <div class="flex gap-2 @lg:col-span-2">
                  <button type="submit" class="btn-primary">Add role</button>
                  <button type="button" class="btn-ghost" @click="newRole = null">Cancel</button>
                </div>
              </form>
              <button v-else type="button" class="btn-light" @click="newRole = { label: '', description: '' }"><Plus class="size-4" aria-hidden="true" /> Add an organisation role</button>
            </template>
            <p v-else class="text-xs text-gray-500">Only an administrator adds or removes organisation roles.</p>
          </section>
            </template>
            <template #libraries>
              <section aria-label="Libraries" class="max-w-4xl space-y-3">
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
                    <ConfirmAction
                      v-if="l.status === 'active'"
                      label="Archive"
                      confirm-label="Archive it"
                      :aria-label="`Archive ${l.name}`"
                      :message="`Archive the library “${l.name}”? Its services leave the catalogue and every kiosk until it is restored.`"
                      trigger-class="btn-ghost h-8 px-2"
                      @confirm="libCall(() => api(`/api/library/libraries/${l.id}/archive`, {}))"
                      ><Archive class="size-4" aria-hidden="true"
                    /></ConfirmAction>
                    <button v-else type="button" class="btn-ghost h-8 px-2" :aria-label="`Restore ${l.name}`" @click="libCall(() => api(`/api/library/libraries/${l.id}/restore`, {}))"><ArchiveRestore class="size-4" aria-hidden="true" /></button>
                  </template>
                </template>
              </li>
            </ul>
            <template v-if="can.edit">
              <form v-if="newLib" class="card grid gap-2 p-3 @lg:grid-cols-2" @submit.prevent="libCall(() => api('/api/library/libraries', { name: newLib!.name, ...(newLib!.description.trim() ? { description: newLib!.description } : {}) }))">
                <label class="text-sm"><span class="mb-1 block text-gray-600">Name</span><input v-model="newLib.name" class="input" required maxlength="80" /></label>
                <label class="text-sm"><span class="mb-1 block text-gray-600">Description</span><input v-model="newLib.description" class="input" maxlength="400" /></label>
                <div class="flex gap-2 @lg:col-span-2">
                  <button type="submit" class="btn-primary">Create library</button>
                  <button type="button" class="btn-ghost" @click="newLib = null">Cancel</button>
                </div>
              </form>
              <button v-else type="button" class="btn-light" @click="newLib = { name: '', description: '' }"><FolderPlus class="size-4" aria-hidden="true" /> New library</button>
            </template>
            <p v-else class="text-xs text-gray-500">Moderators, curators and administrators create and rename libraries.</p>
            <p v-if="can.edit && !can.manage" class="text-xs text-gray-500">Only an administrator archives or restores a library.</p>
          </section>
            </template>
          </AdaptiveNav>
        </template>
      </template>
    </KioskFrame>
  </div>
</template>
