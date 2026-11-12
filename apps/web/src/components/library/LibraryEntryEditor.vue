<script setup lang="ts">
// One library entry (LIB-2..7): a service or journey edited as a form or as YAML, a questionnaire as
// YAML only. It is checked live against the rest of its library, previewed in the adaptive nav, and
// has its revisions. Editors save, submit for review and archive; reviewers accept or reject (never
// their own submission). The YAML is what is saved: the form writes it.
import { JOURNEY_SERVICES, kioskContent } from "@sekaran-ind/yaxb-core/content";
import type { EntryKind, EntryRevision, LibraryEntry, LibraryPermissions } from "@sekaran-ind/yaxb-core/library";
import {
  checkDocument,
  formToJourney,
  formToService,
  journeyToForm,
  newJourneyForm,
  newServiceForm,
  parseDocument,
  questionnaireTemplate,
  resolveLayout,
  serviceToForm,
  toYaml,
  type BundleProblem,
  type JourneyForm as JourneyFormModel,
  type Role,
  type ServiceForm as ServiceFormModel,
} from "@sekaran-ind/yaxb-journeys";
import { FlowPreview, JourneyForm, ServiceForm, YamlEditor } from "@sekaran-ind/yaxb-journeys/vue";
import { Archive, ArchiveRestore, ArrowLeft, Check, History, Loader2, Save, Send, X } from "@lucide/vue";
import { computed, ref, shallowRef, watch } from "vue";
import { useWidth } from "@/composables/width";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import EntryStatus from "./EntryStatus.vue";

const props = defineProps<{
  libraryId: string;
  /** null: a new entry of `kind`. */
  entryId: string | null;
  kind: EntryKind;
  me: { id: string; can: LibraryPermissions; admin: boolean };
  roles: Role[];
  /** The library's entries, for checking and for the form's choices. */
  siblings: LibraryEntry[];
  readonlyLibrary?: boolean;
}>();
const emit = defineEmits<{ close: []; created: [id: string]; changed: [] }>();

const SCREENS = kioskContent.screens.screens.map((s) => s.id);
const { el, width } = useWidth(720);

const entry = shallowRef<LibraryEntry | null>(null);
const revisions = ref<EntryRevision[]>([]);
const yaml = ref("");
const saved = ref("");
const note = ref("");
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
const reviewNote = ref("");

const kind = computed<EntryKind>(() => entry.value?.kind ?? props.kind);
const hasForm = computed(() => kind.value !== "questionnaire");
type View = "form" | "yaml" | "preview" | "history";
const view = ref<View>("yaml");
const dirty = computed(() => yaml.value !== saved.value);
const canEdit = computed(() => props.me.can.edit && !props.readonlyLibrary && entry.value?.status !== "archived");

function starter(): string {
  if (props.kind === "service") return toYaml(formToService({ ...newServiceForm("new-service"), title: "New service" }));
  if (props.kind === "journey") {
    const f = { ...newJourneyForm("new-journey"), title: "New journey" };
    f.steps[0]!.fieldsYaml = "- { id: name, type: text, label: Your name, required: true }";
    const r = formToJourney(f);
    return r.ok ? toYaml(r.doc) : "";
  }
  return questionnaireTemplate("new-questionnaire");
}

async function load() {
  error.value = null;
  if (!props.entryId) {
    entry.value = null;
    revisions.value = [];
    yaml.value = saved.value = "";
    yaml.value = starter();
    openView(hasForm.value ? "form" : "yaml");
    return;
  }
  try {
    const r = await api<{ entry: LibraryEntry; revisions: EntryRevision[] }>(`/api/library/entries/${props.entryId}`);
    entry.value = r.entry;
    revisions.value = r.revisions;
    yaml.value = saved.value = r.entry.yaml;
    if (view.value === "form" || view.value === "yaml") openView(hasForm.value && view.value === "form" ? "form" : view.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// ---- live checking, in the library's context ------------------------------------------------
const others = computed(() => props.siblings.filter((s) => s.id !== props.entryId && s.status !== "archived").map((s) => s.yaml));
const check = computed(() => checkDocument(yaml.value, others.value, { services: JOURNEY_SERVICES, screens: SCREENS, roles: props.roles.map((r) => r.id) }));
const errors = computed(() => check.value.problems.filter((p) => p.level === "error"));
const marks = computed(() => {
  const m = new Map<number, BundleProblem["level"]>();
  for (const p of check.value.problems) if (m.get(p.line) !== "error") m.set(p.line, p.level);
  return m;
});
const editor = ref<InstanceType<typeof YamlEditor> | null>(null);
function goToLine(line: number) {
  openView("yaml");
  setTimeout(() => editor.value?.goToLine(line));
}

// ---- the form (services and journeys) -------------------------------------------------------
const serviceForm = ref<ServiceFormModel>(newServiceForm());
const journeyForm = ref<JourneyFormModel>(newJourneyForm());
const formProblems = ref<string[]>([]);
const formNote = ref<string | null>(null);

/** Read the YAML into the form; false when the form can't show it. */
function formFromYaml(): boolean {
  formNote.value = null;
  const p = parseDocument(yaml.value);
  if (!p.ok) {
    formNote.value = `${p.error} Fix it here to use the form.`;
    return false;
  }
  if (kind.value === "service") serviceForm.value = serviceToForm(p.doc);
  else {
    const r = journeyToForm(p.doc);
    if (r.unsupported.length) {
      formNote.value = `Step${r.unsupported.length > 1 ? "s" : ""} ${r.unsupported.join(", ")} combine${r.unsupported.length > 1 ? "" : "s"} several kinds, which only YAML can edit.`;
      return false;
    }
    journeyForm.value = r.form;
  }
  return true;
}
function openView(v: View) {
  if (v === "form" && (!hasForm.value || !formFromYaml())) v = "yaml";
  view.value = v;
}
function onService(f: ServiceFormModel) {
  serviceForm.value = f;
  yaml.value = toYaml(formToService(f));
}
function onJourney(f: JourneyFormModel) {
  journeyForm.value = f;
  const r = formToJourney(f);
  formProblems.value = r.ok ? [] : r.problems;
  if (r.ok) yaml.value = toYaml(r.doc);
}
const journeyOptions = computed(() => props.siblings.filter((s) => s.kind === "journey" && s.status !== "archived").map((s) => ({ id: s.doc_id, title: s.title })));
const questionnaireOptions = computed(() => props.siblings.filter((s) => s.kind === "questionnaire" && s.status !== "archived").map((s) => ({ id: s.doc_id, title: s.title })));

// ---- actions --------------------------------------------------------------------------------
async function act(fn: () => Promise<void>, done?: string) {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    await fn();
    if (done) notice.value = done;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const save = () =>
  act(async () => {
    if (!entry.value) {
      const r = await api<{ entry: LibraryEntry }>(`/api/library/libraries/${props.libraryId}/entries`, { kind: kind.value, yaml: yaml.value });
      saved.value = yaml.value;
      emit("created", r.entry.id);
      return;
    }
    await api(`/api/library/entries/${entry.value.id}`, { yaml: yaml.value, ...(note.value.trim() ? { note: note.value.trim() } : {}) }, "PUT");
    note.value = "";
    await load();
    emit("changed");
  }, "Saved as a new revision.");
const submit = () =>
  act(async () => {
    await api(`/api/library/entries/${entry.value!.id}/submit`, {});
    await load();
    emit("changed");
  }, "Sent for review.");
const review = (decision: "accept" | "reject") =>
  act(async () => {
    await api(`/api/library/entries/${entry.value!.id}/review`, { decision, ...(reviewNote.value.trim() ? { note: reviewNote.value.trim() } : {}) });
    reviewNote.value = "";
    await load();
    emit("changed");
  }, decision === "accept" ? "Accepted: the kiosk now serves this revision." : "Rejected. The author sees your note.");
const archive = (on: boolean) =>
  act(async () => {
    await api(`/api/library/entries/${entry.value!.id}/${on ? "archive" : "restore"}`, {});
    await load();
    emit("changed");
  }, on ? "Archived: it is off the kiosk." : "Restored as a draft.");

const ownSubmission = computed(() => entry.value?.submitted_by === props.me.id && !props.me.admin);
const canSubmit = computed(() => canEdit.value && entry.value && (entry.value.status === "draft" || entry.value.status === "rejected") && !dirty.value && !errors.value.length);
const canReview = computed(() => props.me.can.review && entry.value?.status === "in_review" && !ownSubmission.value);
function useRevision(r: EntryRevision) {
  yaml.value = r.yaml;
  openView(hasForm.value ? "form" : "yaml");
  notice.value = `Revision ${r.revision} is in the editor. Save to make it the latest.`;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");
// Last: load() fills refs declared above (an immediate watcher runs during setup).
watch(
  () => props.entryId,
  () => {
    view.value = "form";
    error.value = notice.value = null;
    void load();
  },
  { immediate: true },
);
const KIND_LABEL: Record<EntryKind, string> = { service: "Service", journey: "Journey", questionnaire: "Questionnaire" };
const views = computed<{ id: View; label: string }[]>(() => [
  ...(hasForm.value ? [{ id: "form" as const, label: "Form" }] : []),
  { id: "yaml", label: "YAML" },
  { id: "preview", label: "Preview" },
  ...(entry.value ? [{ id: "history" as const, label: `History (${revisions.value.length})` }] : []),
]);
</script>

<template>
  <section ref="el" class="space-y-4" :aria-label="`${KIND_LABEL[kind]} editor`">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <button type="button" class="btn-ghost -ml-2 h-8 px-2 text-sm" @click="emit('close')"><ArrowLeft class="size-4" aria-hidden="true" /> Library</button>
        <h3 class="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
          <span class="eyebrow">{{ KIND_LABEL[kind] }}</span>
          {{ entry?.title ?? `New ${kind}` }}
          <EntryStatus v-if="entry" :status="entry.status" />
        </h3>
        <p v-if="entry" class="text-xs text-gray-500">
          {{ entry.doc_id }} · revision {{ entry.revision }}<template v-if="entry.published_revision"> · the kiosk serves revision {{ entry.published_revision }}</template><template v-else> · not on the kiosk</template>
          · last saved by {{ entry.updated_by_name }}, {{ when(entry.updated_at) }}
        </p>
      </div>
    </div>

    <!-- The review: what was decided, or what is waiting. -->
    <div v-if="entry?.status === 'in_review'" class="rounded-lg bg-info/10 px-3 py-2 text-sm text-ink">
      Sent for review by {{ entry.submitted_by_name }}, {{ when(entry.submitted_at) }}.
      <span v-if="ownSubmission"> Another reviewer has to review it.</span>
    </div>
    <div v-else-if="entry?.status === 'rejected'" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">
      Rejected by {{ entry.reviewed_by_name }}, {{ when(entry.reviewed_at) }}: {{ entry.review_note }}
    </div>
    <div v-else-if="entry?.status === 'accepted'" class="rounded-lg bg-success/10 px-3 py-2 text-sm text-ink">
      Accepted by {{ entry.reviewed_by_name }}, {{ when(entry.reviewed_at) }}<template v-if="entry.review_note">: {{ entry.review_note }}</template>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex gap-0.5 rounded-full bg-mist p-0.5" role="group" aria-label="View">
        <button
          v-for="v in views"
          :key="v.id"
          type="button"
          :aria-pressed="view === v.id"
          :class="cn('rounded-full px-3 py-1.5 text-[13px] font-medium', view === v.id ? 'bg-surface text-ink shadow-sm' : 'text-gray-500 hover:text-ink')"
          @click="openView(v.id)"
        >
          {{ v.label }}
        </button>
      </div>
      <p class="text-sm" :class="errors.length ? 'text-red-800' : 'text-success'" role="status">
        {{ errors.length ? `${errors.length} problem${errors.length === 1 ? "" : "s"}` : "Checks out with the rest of the library" }}<span v-if="dirty" class="text-gray-500"> · unsaved changes</span>
      </p>
    </div>

    <p v-if="formNote" class="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{{ formNote }}</p>

    <!-- Form -->
    <template v-if="view === 'form'">
      <ServiceForm v-if="kind === 'service'" :model-value="serviceForm" :roles="roles" :journeys="journeyOptions" :screens="SCREENS" :readonly="!canEdit" @update:model-value="onService" />
      <JourneyForm v-else :model-value="journeyForm" :roles="roles" :questionnaires="questionnaireOptions" :service-names="JOURNEY_SERVICES" :readonly="!canEdit" @update:model-value="onJourney" />
      <p v-if="formProblems.length" role="alert" class="text-sm text-red-800">{{ formProblems.join(" ") }}</p>
    </template>

    <!-- YAML -->
    <div v-else-if="view === 'yaml'" class="space-y-2">
      <p v-if="kind === 'questionnaire'" class="text-sm text-gray-600">Questionnaires are written as YAML: sections of fields (text, textarea, select, boolean, number, date, source, language), with <code>when</code> to ask a question only sometimes.</p>
      <p v-else-if="hasForm" class="text-xs text-gray-500">Changing the form rewrites this YAML, and comments are dropped.</p>
      <YamlEditor ref="editor" v-model="yaml" :marks="marks" :label="`${KIND_LABEL[kind]} YAML`" :readonly="!canEdit" height="26rem" />
    </div>

    <!-- Preview: the whole library with this draft in it. -->
    <div v-else-if="view === 'preview'" class="rounded-2xl bg-canvas p-3 ring-1 ring-gray-200">
      <FlowPreview :bundle="check.bundle" :layout="resolveLayout(width - 24)" :width="width - 24" storage-key="library.preview" />
    </div>

    <!-- History -->
    <ol v-else class="space-y-2">
      <li v-for="r in revisions" :key="r.revision" class="card p-3">
        <details>
          <summary class="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
            <History class="size-4 text-gray-400" aria-hidden="true" />
            <span class="font-medium text-ink">Revision {{ r.revision }}</span>
            <span class="text-gray-500">{{ r.by_name }}, {{ when(r.at) }}</span>
            <span v-if="r.note" class="text-gray-600">· {{ r.note }}</span>
            <span v-if="r.revision === entry?.published_revision" class="chip">On the kiosk</span>
          </summary>
          <pre class="mt-2 max-h-72 overflow-auto rounded-lg bg-mist p-3 text-xs text-ink">{{ r.yaml }}</pre>
          <button v-if="canEdit && r.revision !== entry?.revision" type="button" class="btn-light mt-2 h-8 text-xs" @click="useRevision(r)">Use this version</button>
        </details>
      </li>
    </ol>

    <!-- Problems -->
    <ul v-if="check.problems.length && view !== 'history'" class="space-y-1">
      <li v-for="(p, i) in check.problems" :key="i">
        <button type="button" class="flex w-full gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-mist" @click="goToLine(p.line)">
          <span :class="p.level === 'error' ? 'font-semibold text-red-800' : 'font-semibold text-gray-700'">{{ p.level === "error" ? "Error" : "Warning" }}</span>
          <span class="text-xs text-gray-500 tabular-nums">L{{ p.line }}</span>
          <span class="text-ink">{{ p.message }}</span>
        </button>
      </li>
    </ul>

    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{{ notice }}</p>

    <!-- Editing -->
    <div v-if="canEdit || (!entry && me.can.edit)" class="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
      <label v-if="entry" class="min-w-48 flex-1 text-sm">
        <span class="mb-1 block text-gray-600">What changed (optional)</span>
        <input v-model="note" class="input" maxlength="200" placeholder="e.g. Added the fever question" />
      </label>
      <button type="button" class="btn-primary" :disabled="busy || (!dirty && Boolean(entry))" @click="save">
        <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Save v-else class="size-4" aria-hidden="true" /> {{ entry ? "Save revision" : `Create ${kind}` }}
      </button>
      <button v-if="entry" type="button" class="btn-light" :disabled="busy || !canSubmit" :title="dirty ? 'Save first' : errors.length ? 'Fix the problems first' : ''" @click="submit">
        <Send class="size-4" aria-hidden="true" /> Submit for review
      </button>
      <button v-if="entry" type="button" class="btn-ghost" :disabled="busy" @click="archive(true)"><Archive class="size-4" aria-hidden="true" /> Archive</button>
      <p v-if="entry?.status === 'in_review' && dirty" class="w-full text-xs text-gray-500">Saving takes it out of review: submit it again afterwards.</p>
    </div>
    <div v-else-if="entry?.status === 'archived' && me.can.edit && !readonlyLibrary" class="border-t border-gray-100 pt-3">
      <button type="button" class="btn-light" :disabled="busy" @click="archive(false)"><ArchiveRestore class="size-4" aria-hidden="true" /> Restore as a draft</button>
    </div>

    <!-- Reviewing -->
    <form v-if="canReview" class="space-y-2 rounded-xl bg-mist p-3" @submit.prevent>
      <p class="text-sm font-medium text-ink">Your review of revision {{ entry?.revision }}</p>
      <textarea v-model="reviewNote" class="input min-h-16" maxlength="1000" placeholder="A note for the author (needed to reject)" aria-label="Review note" />
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" :disabled="busy" @click="review('accept')"><Check class="size-4" aria-hidden="true" /> Accept and publish</button>
        <button type="button" class="btn-light" :disabled="busy || !reviewNote.trim()" @click="review('reject')"><X class="size-4" aria-hidden="true" /> Reject</button>
      </div>
    </form>
  </section>
</template>
