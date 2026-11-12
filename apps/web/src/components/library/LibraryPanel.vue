<script setup lang="ts">
// The journey library (LIB-1..12), Staff → Journey library inside the kiosk's Services:
//   Libraries  every library with its services, journeys and questionnaires; create, rename, archive
//   Review     what is waiting for a reviewer
//   Roles      the built-in roles (Admin, Moderator, Reviewer) and the organisation's own
// The section's place is in the kiosk address (?staff=library&lib=…&entry=…), so links open it.
import type { EntryKind, Library, LibraryEntry, LibraryPermissions } from "@sekaran-ind/yaxb-core/library";
import { roleLabel, type Role } from "@sekaran-ind/yaxb-journeys";
import { provideIcons } from "@sekaran-ind/yaxb-journeys/vue";
import "@sekaran-ind/yaxb-journeys/style.css";
import { Archive, ArchiveRestore, FilePlus2, FolderPlus, Pencil, Plus, RefreshCw, Trash2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import EntryStatus from "./EntryStatus.vue";
import LibraryEntryEditor from "./LibraryEntryEditor.vue";
import ModeratorSignIn from "@/components/moderation/ModeratorSignIn.vue";
import { loadLibraryContent } from "@/composables/library";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { iconFor } from "@/lib/icons";

provideIcons(iconFor);

type LibraryRow = Library & { counts: Record<"total" | "draft" | "in_review" | "accepted" | "rejected" | "archived", number> };
type Overview = { me: { id: string; name: string; roles: string[]; admin: boolean; can: LibraryPermissions }; roles: Role[]; libraries: LibraryRow[]; queue: LibraryEntry[] };

const route = useRoute();
const router = useRouter();
const overview = ref<Overview | null>(null);
const entries = ref<LibraryEntry[]>([]);
const signedOut = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);

const q = (k: string) => (typeof route.query[k] === "string" ? (route.query[k] as string) : null);
const tab = computed(() => (q("tab") === "review" || q("tab") === "roles" ? q("tab")! : "libraries"));
const libId = computed(() => q("lib"));
const entryParam = computed(() => q("entry"));
/** Keep the kiosk's other query keys (screen, staff…) while moving inside the section. */
function go(patch: Record<string, string | null>) {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) if (typeof v === "string") query[k] = v;
  void router.push({ path: route.path, query });
}

async function guard<T>(fn: () => Promise<T>): Promise<T | null> {
  error.value = null;
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) signedOut.value = true;
    else error.value = (e as Error).message;
    return null;
  }
}
async function load() {
  const o = await guard(() => api<Overview>("/api/library"));
  if (!o) return;
  overview.value = o;
  signedOut.value = false;
  if (libId.value) await loadEntries();
}
async function loadEntries() {
  if (!libId.value) return;
  const r = await guard(() => api<{ entries: LibraryEntry[] }>(`/api/library/libraries/${libId.value}/entries`));
  if (r) entries.value = r.entries;
}
watch(libId, () => {
  entries.value = [];
  void loadEntries();
});
void load();

async function changed() {
  await load();
  void loadLibraryContent(); // the kiosk's Services follow what is published
}

const me = computed(() => overview.value?.me);
const can = computed(() => me.value?.can);
const library = computed(() => overview.value?.libraries.find((l) => l.id === libId.value) ?? null);

// ---- libraries ------------------------------------------------------------------------------
const showArchivedLibs = ref(false);
const libraries = computed(() => (overview.value?.libraries ?? []).filter((l) => showArchivedLibs.value || l.status === "active"));
const newLib = ref<{ name: string; description: string } | null>(null);
const editLib = ref<{ name: string; description: string } | null>(null);
async function createLibrary() {
  if (!newLib.value) return;
  busy.value = true;
  const l = await guard(() => api<Library>("/api/library/libraries", { name: newLib.value!.name, ...(newLib.value!.description.trim() ? { description: newLib.value!.description } : {}) }));
  busy.value = false;
  if (!l) return;
  newLib.value = null;
  await load();
  go({ lib: l.id, entry: null });
}
async function saveLibrary() {
  if (!editLib.value || !library.value) return;
  const ok = await guard(() => api(`/api/library/libraries/${library.value!.id}`, { name: editLib.value!.name, description: editLib.value!.description }, "PATCH"));
  if (ok) {
    editLib.value = null;
    await load();
  }
}
async function setLibraryArchived(on: boolean) {
  if (!library.value || (on && !window.confirm(`Archive "${library.value.name}"? Its services and journeys leave the kiosk.`))) return;
  if (await guard(() => api(`/api/library/libraries/${library.value!.id}/${on ? "archive" : "restore"}`, {}))) await changed();
}

// ---- entries --------------------------------------------------------------------------------
const showArchivedEntries = ref(false);
const KINDS: { kind: EntryKind; title: string }[] = [
  { kind: "service", title: "Services" },
  { kind: "journey", title: "Journeys" },
  { kind: "questionnaire", title: "Questionnaires" },
];
const entriesOf = (kind: EntryKind) => entries.value.filter((e) => e.kind === kind && (showArchivedEntries.value || e.status !== "archived"));
/** The open entry: an id, or "new-service" | "new-journey" | "new-questionnaire". */
const editing = computed(() => {
  const p = entryParam.value;
  if (!p) return null;
  const m = p.match(/^new-(service|journey|questionnaire)$/);
  if (m) return { id: null, kind: m[1] as EntryKind };
  const e = entries.value.find((x) => x.id === p) ?? overview.value?.queue.find((x) => x.id === p);
  return e ? { id: e.id, kind: e.kind } : null;
});
function openEntry(e: LibraryEntry) {
  go({ lib: e.library_id, entry: e.id, tab: e.library_id === libId.value ? q("tab") : "libraries" });
}

// ---- roles ----------------------------------------------------------------------------------
const newRole = ref<{ id: string; label: string; description: string } | null>(null);
const editRole = ref<{ id: string; label: string; description: string } | null>(null);
async function addRole() {
  if (!newRole.value) return;
  const r = newRole.value;
  if (await guard(() => api("/api/library/roles", { id: r.id.trim(), label: r.label, ...(r.description.trim() ? { description: r.description } : {}) }))) {
    newRole.value = null;
    await changed();
  }
}
async function saveRole() {
  if (!editRole.value) return;
  const r = editRole.value;
  if (await guard(() => api(`/api/library/roles/${r.id}`, { label: r.label, description: r.description }, "PATCH"))) {
    editRole.value = null;
    await changed();
  }
}
async function removeRole(id: string) {
  if (!window.confirm(`Remove the role "${id}"?`)) return;
  if (await guard(() => api(`/api/library/roles/${id}`, undefined, "DELETE"))) await changed();
}
/** "new-role" → "New role", while the label is still empty. */
watch(
  () => newRole.value?.id,
  (id, old) => {
    if (newRole.value && id && (!newRole.value.label || newRole.value.label === roleLabel(old ?? "", []))) newRole.value.label = roleLabel(id, []);
  },
);

const libraryName = (id: string) => overview.value?.libraries.find((l) => l.id === id)?.name ?? "";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");
const TABS = computed(() => [
  { id: "libraries", label: "Libraries" },
  { id: "review", label: `Review${overview.value?.queue.length ? ` (${overview.value.queue.length})` : ""}` },
  { id: "roles", label: "Roles" },
]);
</script>

<template>
  <div class="space-y-4">
    <ModeratorSignIn v-if="signedOut" why="Sign in with your moderator key to use the journey library." @signed-in="load" />
    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>

    <template v-if="overview && me && can">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex gap-0.5 rounded-full bg-mist p-0.5" role="tablist" aria-label="Journey library">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            role="tab"
            :aria-selected="tab === t.id"
            :class="cn('rounded-full px-3 py-1.5 text-[13px] font-medium', tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-gray-500 hover:text-ink')"
            @click="go({ tab: t.id === 'libraries' ? null : t.id, entry: null })"
          >
            {{ t.label }}
          </button>
        </div>
        <p class="text-xs text-gray-500">
          {{ me.name }} · {{ me.roles.map((r) => roleLabel(r, overview!.roles)).join(", ") }}
          <button type="button" class="ml-1 inline-flex align-middle text-gray-400 hover:text-ink" aria-label="Refresh" @click="load"><RefreshCw class="size-3.5" aria-hidden="true" /></button>
        </p>
      </div>

      <!-- An entry open: the editor. -->
      <LibraryEntryEditor
        v-if="editing && (libId || editing.id)"
        :key="entryParam ?? ''"
        :library-id="libId ?? ''"
        :entry-id="editing.id"
        :kind="editing.kind"
        :me="me"
        :roles="overview.roles"
        :siblings="entries"
        :readonly-library="library?.status === 'archived'"
        @close="go({ entry: null })"
        @created="(id) => (loadEntries(), changed(), go({ entry: id }))"
        @changed="(loadEntries(), changed())"
      />

      <!-- Review queue -->
      <section v-else-if="tab === 'review'" aria-label="Waiting for review" class="space-y-2">
        <p class="text-sm text-gray-600">
          Reviewers read each submission, try it in the preview, then accept it (the kiosk starts serving it) or reject it with a note. Nobody reviews their own submission.
        </p>
        <p v-if="!overview.queue.length" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-600">Nothing is waiting for review.</p>
        <ul class="grid gap-2 @lg:grid-cols-2">
          <li v-for="e in overview.queue" :key="e.id">
            <button type="button" class="card flex w-full flex-col items-start gap-0.5 p-3 text-left hover:border-gray-300" @click="openEntry(e)">
              <span class="eyebrow">{{ e.kind }} · {{ libraryName(e.library_id) }}</span>
              <span class="font-medium text-ink">{{ e.title }}</span>
              <span class="text-xs text-gray-500">Revision {{ e.revision }} from {{ e.submitted_by_name }}, {{ when(e.submitted_at) }}</span>
            </button>
          </li>
        </ul>
      </section>

      <!-- Roles -->
      <section v-else-if="tab === 'roles'" aria-label="Roles" class="space-y-3">
        <p class="text-sm text-gray-600">
          A service lists the roles that deliver it; a journey says who may start it and who finishes it. Admin, Moderator and Reviewer are built in. Give team members roles under Administration.
        </p>
        <ul class="divide-y divide-gray-100 rounded-xl ring-1 ring-gray-100">
          <li v-for="r in overview.roles" :key="r.id" class="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <form v-if="editRole?.id === r.id" class="flex flex-1 flex-wrap items-center gap-2" @submit.prevent="saveRole">
              <input v-model="editRole.label" class="input max-w-48" aria-label="Role name" required />
              <input v-model="editRole.description" class="input min-w-48 flex-1" aria-label="What the role does" />
              <button type="submit" class="btn-primary h-8 px-3 text-xs">Save</button>
              <button type="button" class="btn-ghost h-8 px-2 text-xs" @click="editRole = null">Cancel</button>
            </form>
            <template v-else>
              <span class="min-w-0 flex-1">
                <span class="font-medium text-ink">{{ r.label }}</span> <code class="text-xs text-gray-500">{{ r.id }}</code>
                <span v-if="r.builtin" class="chip ml-1">Built in</span>
                <span v-if="r.description" class="block text-xs text-gray-500">{{ r.description }}</span>
              </span>
              <template v-if="can.manage && !r.builtin">
                <button type="button" class="btn-ghost h-8 px-2" :aria-label="`Change ${r.label}`" @click="editRole = { id: r.id, label: r.label, description: r.description ?? '' }"><Pencil class="size-4" aria-hidden="true" /></button>
                <button type="button" class="btn-ghost h-8 px-2 text-red-800" :aria-label="`Remove ${r.label}`" @click="removeRole(r.id)"><Trash2 class="size-4" aria-hidden="true" /></button>
              </template>
            </template>
          </li>
        </ul>
        <template v-if="can.manage">
          <form v-if="newRole" class="card grid gap-2 p-3 @lg:grid-cols-3" @submit.prevent="addRole">
            <label class="text-sm"><span class="mb-1 block text-gray-600">Id</span><input v-model="newRole.id" class="input" placeholder="front-desk" pattern="[a-z][a-z0-9\-]*" required /></label>
            <label class="text-sm"><span class="mb-1 block text-gray-600">Name</span><input v-model="newRole.label" class="input" placeholder="Front desk" required /></label>
            <label class="text-sm"><span class="mb-1 block text-gray-600">What they do</span><input v-model="newRole.description" class="input" /></label>
            <div class="flex gap-2 @lg:col-span-3">
              <button type="submit" class="btn-primary">Add role</button>
              <button type="button" class="btn-ghost" @click="newRole = null">Cancel</button>
            </div>
          </form>
          <button v-else type="button" class="btn-light" @click="newRole = { id: '', label: '', description: '' }"><Plus class="size-4" aria-hidden="true" /> Add a role</button>
        </template>
        <p v-else class="text-xs text-gray-500">Only an administrator adds or removes roles.</p>
      </section>

      <!-- One library -->
      <section v-else-if="library" :aria-label="library.name" class="space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <button type="button" class="btn-ghost -ml-2 h-8 px-2 text-sm" @click="go({ lib: null })">All libraries</button>
            <form v-if="editLib" class="mt-1 flex flex-wrap gap-2" @submit.prevent="saveLibrary">
              <input v-model="editLib.name" class="input max-w-64" aria-label="Library name" required />
              <input v-model="editLib.description" class="input min-w-48 flex-1" aria-label="Description" />
              <button type="submit" class="btn-primary h-9">Save</button>
              <button type="button" class="btn-ghost h-9" @click="editLib = null">Cancel</button>
            </form>
            <template v-else>
              <h3 class="flex items-center gap-2 text-lg font-semibold text-ink">
                {{ library.name }}<span v-if="library.status === 'archived'" class="chip">Archived</span>
              </h3>
              <p v-if="library.description" class="text-sm text-gray-600">{{ library.description }}</p>
            </template>
          </div>
          <div class="flex flex-wrap gap-1">
            <button v-if="can.edit && !editLib" type="button" class="btn-ghost h-8 px-2 text-sm" @click="editLib = { name: library.name, description: library.description ?? '' }"><Pencil class="size-4" aria-hidden="true" /> Rename</button>
            <template v-if="can.manage">
              <button v-if="library.status === 'active'" type="button" class="btn-ghost h-8 px-2 text-sm" @click="setLibraryArchived(true)"><Archive class="size-4" aria-hidden="true" /> Archive library</button>
              <button v-else type="button" class="btn-light h-8 text-sm" @click="setLibraryArchived(false)"><ArchiveRestore class="size-4" aria-hidden="true" /> Restore library</button>
            </template>
          </div>
        </div>

        <div v-if="can.edit && library.status === 'active'" class="flex flex-wrap gap-2">
          <button v-for="k in KINDS" :key="k.kind" type="button" class="btn-light h-9 text-sm" @click="go({ entry: `new-${k.kind}` })"><FilePlus2 class="size-4" aria-hidden="true" /> New {{ k.kind }}</button>
        </div>
        <label class="inline-flex items-center gap-2 text-sm text-gray-600"><input v-model="showArchivedEntries" type="checkbox" class="size-4 accent-brand" /> Show archived</label>

        <section v-for="k in KINDS" :key="k.kind" :aria-labelledby="`lib-${k.kind}`">
          <h4 :id="`lib-${k.kind}`" class="eyebrow mb-2">{{ k.title }}</h4>
          <p v-if="!entriesOf(k.kind).length" class="text-sm text-gray-500">None yet.</p>
          <ul class="grid gap-2 @lg:grid-cols-2">
            <li v-for="e in entriesOf(k.kind)" :key="e.id">
              <button type="button" class="card flex w-full items-start justify-between gap-2 p-3 text-left hover:border-gray-300" @click="openEntry(e)">
                <span class="min-w-0">
                  <span class="block font-medium text-ink">{{ e.title }}</span>
                  <span class="block text-xs text-gray-500">{{ e.doc_id }} · revision {{ e.revision }}<template v-if="e.published_revision"> · kiosk: {{ e.published_revision }}</template></span>
                </span>
                <EntryStatus :status="e.status" />
              </button>
            </li>
          </ul>
        </section>
      </section>

      <!-- All libraries -->
      <section v-else aria-label="Libraries" class="space-y-3">
        <p class="text-sm text-gray-600">Each library holds services, the journeys they open and the questionnaires those ask. What a reviewer accepts appears on the kiosk's Services screen.</p>
        <div class="flex flex-wrap items-center gap-3">
          <button v-if="can.edit && !newLib" type="button" class="btn-light" @click="newLib = { name: '', description: '' }"><FolderPlus class="size-4" aria-hidden="true" /> New library</button>
          <label class="inline-flex items-center gap-2 text-sm text-gray-600"><input v-model="showArchivedLibs" type="checkbox" class="size-4 accent-brand" /> Show archived</label>
        </div>
        <form v-if="newLib" class="card grid gap-2 p-3 @lg:grid-cols-2" @submit.prevent="createLibrary">
          <label class="text-sm"><span class="mb-1 block text-gray-600">Name</span><input v-model="newLib.name" class="input" required maxlength="80" placeholder="Outpatient clinic" /></label>
          <label class="text-sm"><span class="mb-1 block text-gray-600">Description</span><input v-model="newLib.description" class="input" maxlength="400" /></label>
          <div class="flex gap-2 @lg:col-span-2">
            <button type="submit" class="btn-primary" :disabled="busy">Create library</button>
            <button type="button" class="btn-ghost" @click="newLib = null">Cancel</button>
          </div>
        </form>
        <p v-if="!libraries.length" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-600">No libraries yet.</p>
        <ul class="grid gap-2 @lg:grid-cols-2">
          <li v-for="l in libraries" :key="l.id">
            <button type="button" class="card flex w-full flex-col items-start gap-1 p-3 text-left hover:border-gray-300" @click="go({ lib: l.id, entry: null })">
              <span class="flex items-center gap-2 font-medium text-ink">{{ l.name }}<span v-if="l.status === 'archived'" class="chip">Archived</span></span>
              <span v-if="l.description" class="text-xs text-gray-500">{{ l.description }}</span>
              <span class="flex flex-wrap gap-1 pt-1 text-xs">
                <span class="chip">{{ l.counts.total }} entries</span>
                <span v-if="l.counts.accepted" class="chip">{{ l.counts.accepted }} accepted</span>
                <span v-if="l.counts.in_review" class="chip">{{ l.counts.in_review }} in review</span>
                <span v-if="l.counts.draft" class="chip">{{ l.counts.draft }} drafts</span>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
