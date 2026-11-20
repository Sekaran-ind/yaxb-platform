<script setup lang="ts">
// One service in the catalogue (LIB-14..17): design it (journeys, their screens, and the roles in the
// side panel), or edit its YAML; try it in the preview; read its summary, audit trail and history.
// Its author (or an editor) saves, submits and archives it; reviewers accept or reject it. The YAML
// is what is saved: the designer writes it. A published service someone else owns opens read-only,
// from the catalogue. The Service Designer agent is a conversation kept with the service
// (DesignerChat, LIB-39..41): a new service can start from a description, and any service can be
// changed by asking, during review too. The entry created from a draft remembers it, so the agent
// learns from its review. A new service not created yet is kept in this browser until it is.
import { parseConnector, connectorSecrets as connectorSecretNames } from "@sekaran-ind/yaxb-core/connectors";
import ConnectorSecrets from "./ConnectorSecrets.vue";
import { parseRoutine, ROUTINE_STARTERS } from "@sekaran-ind/yaxb-core/routines";
import RoutineDryRun from "./RoutineDryRun.vue";
import RoutineRuns from "./RoutineRuns.vue";
import type { EntryRevision, Library, LibraryEntry, LibraryPermissions } from "@sekaran-ind/yaxb-core/library";
import {
  checkDocument,
  designFromDoc,
  designToDoc,
  newServiceDesign,
  parseDocument,
  resolveLayout,
  roleLabel,
  serviceTemplate,
  toYaml,
  type Role,
  type ServiceDesign,
} from "@sekaran-ind/yaxb-journeys";
import { ConfirmAction, FlowPreview, ServiceDesigner, ServiceSummary, YamlEditor } from "@sekaran-ind/yaxb-journeys/vue";
import { Archive, ArchiveRestore, ArrowLeft, Check, History, Loader2, Save, Send, X } from "@lucide/vue";
import { computed, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import DesignerChat from "./DesignerChat.vue";
import ConsentPanel from "./ConsentPanel.vue";
import JourneyFlow from "./JourneyFlow.vue";
import EntryStatus from "./EntryStatus.vue";
import ServiceAudit from "./ServiceAudit.vue";
import OrganisationView from "./OrganisationView.vue";
import SegmentedControl from "@/components/site/SegmentedControl.vue";
import { useWidth } from "@/composables/width";
import { catalogue, journeyServiceNames, type CatalogueService } from "@/composables/library";
import type { BundleProblem } from "@sekaran-ind/yaxb-journeys";
import { api, ApiError } from "@/lib/api";

/** A new service opened from one of the home page's ideas (`/catalogue?service=new&idea=…`) starts the designer's first message with it. */
const route = useRoute();
const idea = computed(() => (typeof route.query.idea === "string" ? route.query.idea : undefined));

const props = defineProps<{
  /** null: a new service. */
  entryId: string | null;
  me: { id: string; name: string; roles: string[]; guest: boolean; admin: boolean; can: LibraryPermissions };
  /** The organisation's roles (built in and added by administrators). */
  roles: Role[];
  libraries: Library[];
  /** The published service, when this viewer can't open the entry itself (read-only). */
  published?: CatalogueService | null;
}>();
const emit = defineEmits<{ close: []; created: [id: string]; changed: []; step: [step: { index: number; total: number; label: string } | null] }>();

const { el, width } = useWidth(900);
const entry = shallowRef<LibraryEntry | null>(null);
const revisions = ref<EntryRevision[]>([]);
const mayChange = ref(false);
const readOnlyCopy = ref(false);
const yaml = ref("");
const saved = ref("");
const note = ref("");
const reviewNote = ref("");
const libraryChoice = ref("default");
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

// ---- the Service Designer conversation ------------------------------------------------------------
/** The draft the editor holds, so the entry created from it is linked to it. */
const draftRun = ref<string | null>(null);
/** A new service's conversation, linked to the entry when it is created. */
const threadId = ref<string | null>(null);
/** A new routine starts from one of the starters (`?routine=<id>`, or `blank`), RTN-1. */
const routineStarter = computed(() => {
  const id = typeof route.query.routine === "string" ? route.query.routine : null;
  if (!id) return null;
  return ROUTINE_STARTERS.find((r) => r.id === id)?.yaml ?? BLANK_ROUTINE;
});
const BLANK_ROUTINE = `kind: routine
id: new-routine
title: New routine
summary: What it does, in a sentence.
on:
  schedule: { every: day, at: "09:00" }
actions:
  - message: { to: manager, text: "Good morning." }
`;
const STARTER = routineStarter.value ?? serviceTemplate("new-service");
function applyDraft(next: string, run: string | null) {
  yaml.value = next;
  if (run) draftRun.value = run;
  openView(view.value === "design" || view.value === "yaml" || view.value === "preview" ? view.value : "design");
}

// A new service isn't lost on a reload: it is kept in this browser (with its conversation) until created.
const UNSAVED = "yaxb.catalogue.unsaved";
type Unsaved = { yaml: string; thread: string | null; run: string | null };
function readUnsaved(): Unsaved | null {
  try {
    const v = JSON.parse(localStorage.getItem(UNSAVED) ?? "null") as Unsaved | null;
    return v && typeof v.yaml === "string" ? v : null;
  } catch {
    return null;
  }
}
function keepUnsaved() {
  if (props.entryId || readOnlyCopy.value || routineStarter.value) return;
  try {
    if (yaml.value === STARTER && !threadId.value) localStorage.removeItem(UNSAVED);
    else localStorage.setItem(UNSAVED, JSON.stringify({ yaml: yaml.value, thread: threadId.value, run: draftRun.value } satisfies Unsaved));
  } catch {
    /* private mode */
  }
}
const forgetUnsaved = () => {
  try {
    localStorage.removeItem(UNSAVED);
  } catch {
    /* private mode */
  }
};
function startOver() {
  forgetUnsaved();
  yaml.value = STARTER;
  threadId.value = draftRun.value = null;
  notice.value = null;
  openView("design");
}

type View = "design" | "org" | "yaml" | "preview" | "flow" | "consent" | "summary" | "audit" | "history" | "secrets" | "dry" | "runs";
/** The organisation (ORG-1) is an entry too: it has its own view, YAML, audit and history. */
const isOrg = computed(() => entry.value?.kind === "organisation" || /^kind:\s*organisation\b/m.test(yaml.value));
/** A connector (CNX-2) is an entry too: YAML, its secrets, audit and history. */
const isConnector = computed(() => (entry.value?.kind as string) === "connector" || /^kind:\s*connector\b/m.test(yaml.value));
const connectorCheck = computed(() => (isConnector.value ? parseConnector(yaml.value) : null));
/** A routine (RTN-1) is an entry too: YAML, a dry run, its runs, audit and history. */
const isRoutine = computed(() => (entry.value?.kind as string) === "routine" || /^kind:\s*routine\b/m.test(yaml.value));
const routineCheck = computed(() => (isRoutine.value ? parseRoutine(yaml.value) : null));
const published_ = computed(() => Boolean(entry.value?.published_yaml));
/** The server's problems as of the last save: the organisation's checks need the catalogue and who is staffed (ORG-5). */
const serverProblems = ref<BundleProblem[]>([]);
const orgWarnings = computed(() => (dirty.value ? check.value.problems : serverProblems.value).filter((p) => p.level === "warning" && p.kind === "organisation"));
const view = ref<View>("design");
const dirty = computed(() => yaml.value !== saved.value);
const editable = computed(() => (props.entryId === null || mayChange.value) && !readOnlyCopy.value && entry.value?.status !== "archived");

/** Opened before the catalogue's list arrived: its copy fills in when it does. */
const awaitingCopy = ref(false);
watch(
  () => props.published,
  (p) => {
    if (!awaitingCopy.value || !p) return;
    awaitingCopy.value = false;
    yaml.value = saved.value = p.yaml;
    // The designer gave up on the empty YAML before: try it again with the copy.
    designNote.value = null;
    openView(view.value === "yaml" ? "design" : view.value);
  },
);
async function load() {
  awaitingCopy.value = false;
  error.value = notice.value = null;
  readOnlyCopy.value = false;
  if (!props.entryId) {
    entry.value = null;
    revisions.value = [];
    saved.value = "";
    // A new routine starts from its starter; the unsaved new service stays kept for later.
    const kept = routineStarter.value ? null : readUnsaved();
    yaml.value = kept?.yaml ?? STARTER;
    threadId.value = kept?.thread ?? null;
    draftRun.value = kept?.run ?? null;
    mayChange.value = true;
    if (kept && kept.yaml !== STARTER) notice.value = "Your new service is as you left it: it stays in this browser until you create it.";
    openView("design");
    return;
  }
  try {
    const r = await api<{ entry: LibraryEntry; revisions: EntryRevision[]; canChange: boolean; problems?: BundleProblem[] }>(`/api/library/entries/${props.entryId}`);
    serverProblems.value = r.problems ?? [];
    entry.value = r.entry;
    revisions.value = r.revisions;
    mayChange.value = r.canChange;
    yaml.value = saved.value = r.entry.yaml;
  } catch (e) {
    // Someone else's published service: read the catalogue's copy (now, or when the list arrives).
    if (e instanceof ApiError && e.status === 404) {
      entry.value = null;
      readOnlyCopy.value = true;
      mayChange.value = false;
      if (props.published) yaml.value = saved.value = props.published.yaml;
      else awaitingCopy.value = true;
    } else error.value = (e as Error).message;
  }
  openView(view.value === "design" ? "design" : view.value);
}

// ---- checking -------------------------------------------------------------------------------
const check = computed(() => checkDocument(yaml.value, [], { services: journeyServiceNames.value, roles: props.roles.map((r) => r.id) }));
const errors = computed(() =>
  routineCheck.value ? (routineCheck.value.ok ? [] : routineCheck.value.problems.map((message) => ({ level: "error" as const, line: 1, message, kind: "routine", id: "" }))) :
  connectorCheck.value ? (connectorCheck.value.ok ? [] : connectorCheck.value.problems.map((message) => ({ level: "error" as const, line: 1, message, kind: "connector", id: "" }))) : check.value.problems.filter((p) => p.level === "error"),
);
/** The Ethics checklist (ETH-1, ETH-4): high findings need the reviewer's reason to accept. */
const ethics = computed(() => check.value.problems.filter((p) => p.ethics).sort((a, b) => (a.ethics!.severity === b.ethics!.severity ? a.line - b.line : a.ethics!.severity === "high" ? -1 : 1)));
const ethicsHigh = computed(() => ethics.value.filter((p) => p.ethics!.severity === "high").length);
const editor = ref<InstanceType<typeof YamlEditor> | null>(null);
function goToLine(line: number) {
  openView("yaml");
  setTimeout(() => editor.value?.goToLine(line));
}

// ---- the designer ---------------------------------------------------------------------------
const design = ref<ServiceDesign>(newServiceDesign());
const designNote = ref<string | null>(null);
/** The designer is on its last step, which offers Save itself. */
const designerAtEnd = ref(false);
const designProblems = ref<string[]>([]);
function designFromYaml(): boolean {
  designNote.value = null;
  const p = parseDocument(yaml.value);
  let why: string | null = null;
  if (!p.ok) why = `${p.error} Fix it in YAML to use the designer.`;
  else if (p.doc.journeys === undefined) why = "This service has no journeys inside it, so it can only be edited as YAML.";
  else {
    const r = designFromDoc(p.doc);
    if (r.unsupported.length) why = `Screens ${r.unsupported.join(", ")} combine several kinds, which only YAML can edit.`;
    else design.value = r.design;
  }
  designNote.value = why;
  return !why;
}
function openView(v: View) {
  if (isRoutine.value && v !== "yaml" && v !== "audit" && v !== "history" && v !== "dry" && v !== "runs") v = "yaml";
  else if (isConnector.value && v !== "yaml" && v !== "audit" && v !== "history" && v !== "secrets") v = "yaml";
  else if (isOrg.value && v !== "yaml" && v !== "audit" && v !== "history") v = check.value.bundle.organisations[0] ? "org" : "yaml";
  else if (v === "org") v = "design";
  if (v === "design" && !designFromYaml()) v = "yaml";
  if ((v === "audit" || v === "history") && !entry.value) v = "summary";
  view.value = v;
  if (v !== "design") emit("step", null);
}
function onDesign(d: ServiceDesign) {
  design.value = d;
  const r = designToDoc(d);
  designProblems.value = r.ok ? [] : r.problems;
  if (r.ok) yaml.value = toYaml(r.doc);
}

// ---- actions --------------------------------------------------------------------------------
async function act(fn: () => Promise<void>, done?: string) {
  busy.value = true;
  error.value = notice.value = null;
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
      const r = await api<{ entry: LibraryEntry }>("/api/library/services", {
        yaml: yaml.value,
        library: libraryChoice.value,
        ...(draftRun.value ? { design: draftRun.value } : {}),
        ...(threadId.value ? { thread: threadId.value } : {}),
      });
      saved.value = yaml.value;
      forgetUnsaved();
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
  }, "Sent for review. A reviewer will accept it or tell you what to change.");
const review = (decision: "accept" | "reject") =>
  act(async () => {
    await api(`/api/library/entries/${entry.value!.id}/review`, { decision, ...(reviewNote.value.trim() ? { note: reviewNote.value.trim() } : {}) });
    reviewNote.value = "";
    await load();
    emit("changed");
  }, decision === "accept" ? "Published: kiosks can load this service now." : "Rejected. The author sees your note.");
const archive = (on: boolean) =>
  act(async () => {
    await api(`/api/library/entries/${entry.value!.id}/${on ? "archive" : "restore"}`, {});
    await load();
    emit("changed");
  });

const own = computed(() => Boolean(entry.value && (entry.value.owner_id === props.me.id || entry.value.submitted_by === props.me.id) && !props.me.admin));
const canSubmit = computed(() => mayChange.value && entry.value && (entry.value.status === "draft" || entry.value.status === "rejected") && !dirty.value && !errors.value.length);
const canReview = computed(() => props.me.can.review && entry.value?.status === "in_review" && !own.value);
// Say why an action isn't offered, instead of hiding it silently (docs/ux/patterns.md, Feedback).
/** Why this viewer can't publish a service that is waiting for review. */
const reviewBlocked = computed(() => {
  if (entry.value?.status !== "in_review" || canReview.value) return null;
  if (props.me.can.review) return "This is your own service: another reviewer publishes it.";
  if (props.me.guest) return "Waiting for a reviewer: a reviewer publishes it, and you'll see the result here.";
  const roles = props.me.roles.map((r) => roleLabel(r, props.roles)).join(", ");
  return `Waiting for a reviewer. Your roles (${roles || "none"}) can't publish; ask an administrator for the Reviewer role.`;
});
/** Why Submit for review can't be pressed yet. */
const submitBlocked = computed(() => {
  if (!entry.value || canSubmit.value) return null;
  if (entry.value.status === "in_review" && !dirty.value) return "it is waiting for a reviewer.";
  if (entry.value.status === "accepted" && !dirty.value) return "it is published. Save a change to send a new revision for review.";
  if (dirty.value) return "save first.";
  if (errors.value.length) return "fix the problems first.";
  return null;
});
/** Why the service can't be changed here. */
const lockedBecause = computed(() => {
  if (editable.value) return null;
  if (readOnlyCopy.value) return "You can read this service and open it in a kiosk. Only its designer, or a moderator, curator or administrator, can change it.";
  if (entry.value?.status === "archived") return mayChange.value ? "Archived: restore it as a draft to change it." : "Archived. Only its designer, or a moderator, curator or administrator, can restore it.";
  if (entry.value) return "Only its designer, or a moderator, curator or administrator, can change it.";
  return null;
});
function useRevision(r: EntryRevision) {
  yaml.value = r.yaml;
  openView("design");
  notice.value = `Revision ${r.revision} is in the editor. Save to make it the latest.`;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");
const title = computed(() => entry.value?.title ?? props.published?.title ?? (routineCheck.value?.ok ? routineCheck.value.routine.title : isRoutine.value ? "New routine" : design.value.title || "New service"));
/** Where the service records what happens (LIB-62): the consent forms say so. */
const entryStorage = computed(() => {
  const st = (entry.value as { storage?: string } | null)?.storage ?? props.published?.storage;
  return st === "box" || st === "server" ? st : "none";
});
const VIEWS = computed<{ value: View; label: string }[]>(() => isRoutine.value ? [
  { value: "yaml", label: "YAML" },
  { value: "dry", label: "Dry run" },
  ...(entry.value ? [...(published_.value ? [{ value: "runs" as const, label: "Runs" }] : []), { value: "audit" as const, label: "Audit" }, { value: "history" as const, label: `History (${revisions.value.length})` }] : []),
] : isConnector.value ? [
  { value: "yaml", label: "YAML" },
  ...(entry.value ? [{ value: "secrets" as const, label: "Secrets" }, { value: "audit" as const, label: "Audit" }, { value: "history" as const, label: `History (${revisions.value.length})` }] : []),
] : isOrg.value ? [
  { value: "org", label: "Organisation" },
  { value: "yaml", label: "YAML" },
  ...(entry.value ? [{ value: "audit" as const, label: "Audit" }, { value: "history" as const, label: `History (${revisions.value.length})` }] : []),
] : [
  { value: "design", label: "Design" },
  { value: "yaml", label: "YAML" },
  { value: "preview", label: "Preview" },
  { value: "flow", label: "Flow" },
  { value: "consent", label: "Consent" },
  { value: "summary", label: "Summary" },
  ...(entry.value ? [{ value: "audit" as const, label: "Audit" }, { value: "history" as const, label: `History (${revisions.value.length})` }] : []),
]);

watch([yaml, threadId], keepUnsaved);
/** Reviewers of a service in review can talk to the designer too (suggestions); so can whoever may change it. */
const showChat = computed(() => !isOrg.value && !isConnector.value && !isRoutine.value && !readOnlyCopy.value && (editable.value || canReview.value));

// Last: load() fills refs declared above (an immediate watcher runs during setup).
watch(
  () => props.entryId,
  () => {
    view.value = "design";
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section ref="el" class="space-y-4" aria-label="Service">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <button type="button" class="btn-ghost -ml-2 h-8 px-2 text-sm" @click="emit('close')"><ArrowLeft class="size-4" aria-hidden="true" /> Catalogue</button>
        <h2 class="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
          {{ title }}
          <EntryStatus v-if="entry" :status="entry.status" />
          <span v-else-if="readOnlyCopy" class="chip">Published · read-only</span>
        </h2>
        <p v-if="entry" class="text-xs text-gray-500">
          {{ entry.doc_id }} · revision {{ entry.revision }}<template v-if="entry.published_revision"> · kiosks get revision {{ entry.published_revision }}</template> · by {{ entry.owner_name ?? "unknown" }} ·
          last saved {{ when(entry.updated_at) }}
        </p>
      </div>
    </div>

    <div v-if="entry?.status === 'in_review'" class="rounded-lg bg-info/10 px-3 py-2 text-sm text-ink">
      Sent for review by {{ entry.submitted_by_name }}, {{ when(entry.submitted_at) }}.
    </div>
    <div v-else-if="entry?.status === 'rejected'" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">Rejected by {{ entry.reviewed_by_name }}, {{ when(entry.reviewed_at) }}: {{ entry.review_note }}</div>
    <div v-else-if="entry?.status === 'accepted'" class="rounded-lg bg-success/10 px-3 py-2 text-sm text-ink">
      Published by {{ entry.reviewed_by_name }}, {{ when(entry.reviewed_at) }}<template v-if="entry.review_note">: {{ entry.review_note }}</template>
    </div>
    <div v-if="me.guest && !entry && !readOnlyCopy" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-700">
      You're designing as a guest: your services stay with this browser. A reviewer publishes them for kiosks.
    </div>

    <!-- The Service Designer: a conversation kept with the service (new, draft, sent back or in review). -->
    <DesignerChat
      v-if="showChat"
      :entry-id="entry?.id ?? null"
      :thread-id="entry ? null : threadId"
      :yaml="yaml"
      :pristine="yaml === STARTER"
      :editable="editable"
      :idea="entry ? undefined : idea"
      @apply="applyDraft"
      @thread="(id) => (threadId = id)"
    />
    <p v-if="!entry && editable && !readOnlyCopy && (yaml !== STARTER || threadId)" class="-mt-2 text-right">
      <button type="button" class="btn-ghost h-7 px-2 text-xs" @click="startOver">Start over</button>
    </p>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <SegmentedControl :model-value="view" :options="VIEWS" label="View" @update:model-value="openView" />
      <p class="text-sm" :class="errors.length ? 'text-red-800' : 'text-success'" role="status">
        {{ errors.length ? `${errors.length} problem${errors.length === 1 ? "" : "s"}` : !entry || entry.status === "draft" || entry.status === "rejected" ? "Ready to submit" : "No problems" }}<span v-if="dirty && editable" class="text-gray-500"> · unsaved changes</span>
      </p>
    </div>

    <p v-if="designNote" class="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{{ designNote }}</p>

    <RoutineDryRun v-if="view === 'dry'" :yaml="yaml" :problems="errors.map((p) => p.message)" />
    <RoutineRuns v-else-if="view === 'runs' && entry" :entry-id="entry.id" />
    <ConnectorSecrets v-else-if="view === 'secrets' && connectorCheck?.ok" :connector="connectorCheck.connector.id" :needed="connectorSecretNames(connectorCheck.connector)" />
    <OrganisationView v-else-if="view === 'org' && check.bundle.organisations[0]" :organisation="check.bundle.organisations[0]" :services="catalogue" :warnings="orgWarnings" @line="goToLine" />
    <template v-else-if="view === 'design'">
      <ServiceDesigner :model-value="design" :service-names="journeyServiceNames" :readonly="!editable" @update:model-value="onDesign" @last="(v) => (designerAtEnd = v)" @step="(st) => emit('step', st)">
        <!-- The last step offers the real next action: create or save, then submit for review. -->
        <template #finish="{ ok }">
          <template v-if="editable">
            <span v-if="!ok && (!entry || dirty)" class="yj-small yj-muted">You can save now; fix the problems before you submit it.</span>
            <button v-if="!entry || dirty" type="button" class="yj-btn yj-btn-primary" :disabled="busy" @click="save">{{ entry ? "Save revision" : "Create service" }}</button>
            <button v-else-if="canSubmit" type="button" class="yj-btn yj-btn-primary" :disabled="busy" @click="submit">Submit for review</button>
            <span v-else class="yj-small yj-muted">{{ submitBlocked ? `Submit for review: ${submitBlocked}` : "Saved." }}</span>
          </template>
          <span v-else class="yj-small yj-muted">{{ lockedBecause ?? "This is the last step." }}</span>
        </template>
      </ServiceDesigner>
      <p v-if="designProblems.length" role="alert" class="text-sm text-red-800">{{ designProblems.join(" ") }}</p>
    </template>
    <div v-else-if="view === 'yaml'" class="space-y-2">
      <p class="text-xs text-gray-500">{{ isRoutine ? "A routine: what sets it off (on), an optional condition (when), and its actions in order. It never pays anything." : isOrg ? "The organisation: its units, their roles, who reports to whom, and the services each runs." : "A service with its journeys and their screens. Changing the design rewrites this YAML, and comments are dropped." }}</p>
      <YamlEditor ref="editor" v-model="yaml" :problems="isRoutine ? errors : check.problems" :label="isRoutine ? 'Routine YAML' : isOrg ? 'Organisation YAML' : 'Service YAML'" :readonly="!editable" height="32rem" />
    </div>
    <div v-else-if="view === 'preview'" class="rounded-2xl bg-canvas p-3 ring-1 ring-gray-200">
      <FlowPreview :bundle="check.bundle" :layout="resolveLayout(width - 24)" :width="width - 24" storage-key="catalogue.preview" />
    </div>
    <JourneyFlow v-else-if="view === 'flow'" :bundle="check.bundle" :problems="check.problems" @line="goToLine" />
    <ConsentPanel v-else-if="view === 'consent'" v-model="yaml" :editable="editable" :storage="entryStorage" :roles="roles" />
    <div v-else-if="view === 'summary'" class="space-y-4">
      <ServiceSummary :bundle="check.bundle" />
      <dl v-if="entry" class="grid gap-x-6 gap-y-1 rounded-xl bg-mist p-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt class="text-gray-500">Library</dt>
        <dd class="text-ink">{{ libraries.find((l) => l.id === entry!.library_id)?.name ?? "" }}</dd>
        <dt class="text-gray-500">Status</dt>
        <dd><EntryStatus :status="entry.status" /></dd>
        <dt class="text-gray-500">Designed by</dt>
        <dd class="text-ink">{{ entry.owner_name }} · {{ when(entry.created_at) }}</dd>
        <dt class="text-gray-500">Revisions</dt>
        <dd class="text-ink">{{ entry.revision }}<template v-if="entry.published_revision"> (kiosks get {{ entry.published_revision }})</template></dd>
        <template v-if="entry.reviewed_by_name">
          <dt class="text-gray-500">Last review</dt>
          <dd class="text-ink">{{ entry.reviewed_by_name }}, {{ when(entry.reviewed_at) }}</dd>
        </template>
      </dl>
    </div>
    <ServiceAudit v-else-if="view === 'audit' && entry" :entry-id="entry.id" />
    <ol v-else-if="view === 'history'" class="space-y-2">
      <li v-for="r in revisions" :key="r.revision" class="card p-3">
        <details>
          <summary class="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
            <History class="size-4 text-gray-400" aria-hidden="true" />
            <span class="font-medium text-ink">Revision {{ r.revision }}</span>
            <span class="text-gray-500">{{ r.by_name }}, {{ when(r.at) }}</span>
            <span v-if="r.note" class="text-gray-600">· {{ r.note }}</span>
            <span v-if="r.revision === entry?.published_revision" class="chip">On kiosks</span>
          </summary>
          <pre class="mt-2 max-h-72 overflow-auto rounded-lg bg-mist p-3 text-xs text-ink">{{ r.yaml }}</pre>
          <button v-if="editable && r.revision !== entry?.revision" type="button" class="btn-light mt-2 h-8 text-xs" @click="useRevision(r)">Use this version</button>
        </details>
      </li>
    </ol>

    <ul v-if="check.problems.length && ['design', 'yaml', 'preview'].includes(view)" class="space-y-1">
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

    <div v-if="editable" class="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
      <label v-if="!entry && !me.guest && libraries.length" class="text-sm">
        <span class="mb-1 block text-gray-600">Library</span>
        <select v-model="libraryChoice" class="input">
          <option value="default">Service catalogue (default)</option>
          <option v-for="l in libraries.filter((x) => x.status === 'active')" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
      </label>
      <label v-if="entry" class="min-w-48 flex-1 text-sm">
        <span class="mb-1 block text-gray-600">What changed (optional)</span>
        <input v-model="note" class="input" maxlength="200" placeholder="e.g. Added a triage journey for nurses" />
      </label>
      <!-- In the designer its steps lead (the last one offers Save), so Save is secondary there. -->
      <button v-if="!(view === 'design' && designerAtEnd)" type="button" :class="view === 'design' ? 'btn-light' : 'btn-primary'" :disabled="busy || (!dirty && Boolean(entry))" @click="save">
        <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Save v-else class="size-4" aria-hidden="true" /> {{ entry ? "Save revision" : isRoutine ? "Create routine" : "Create service" }}
      </button>
      <button v-if="entry" type="button" class="btn-light" :disabled="busy || !canSubmit" :aria-describedby="submitBlocked ? 'submit-why' : undefined" @click="submit">
        <Send class="size-4" aria-hidden="true" /> Submit for review
      </button>
      <ConfirmAction
        v-if="entry"
        label="Archive"
        confirm-label="Archive it"
        :message="`Archive “${title}”? It leaves the catalogue and every kiosk. You can restore it as a draft later.`"
        trigger-class="btn-ghost"
        :busy="busy"
        @confirm="archive(true)"
      >
        <Archive class="size-4" aria-hidden="true" /> Archive
      </ConfirmAction>
      <p v-if="submitBlocked" id="submit-why" class="w-full text-xs text-gray-500">Submit for review: {{ submitBlocked }}</p>
      <p v-if="entry?.status === 'in_review' && dirty" class="w-full text-xs text-gray-500">Saving takes it out of review: submit it again afterwards.</p>
    </div>
    <div v-else-if="entry?.status === 'archived' && mayChange" class="border-t border-gray-100 pt-3">
      <button type="button" class="btn-light" :disabled="busy" @click="archive(false)"><ArchiveRestore class="size-4" aria-hidden="true" /> Restore as a draft</button>
    </div>
    <p v-if="lockedBecause && !(entry?.status === 'archived' && mayChange)" class="rounded-lg bg-mist px-3 py-2 text-sm text-gray-700">{{ lockedBecause }}</p>
    <p v-if="reviewBlocked" class="rounded-lg bg-info/10 px-3 py-2 text-sm text-ink">{{ reviewBlocked }}</p>

    <form v-if="canReview" class="space-y-2 rounded-xl bg-mist p-3" @submit.prevent>
      <p class="text-sm font-medium text-ink">Your review of revision {{ entry?.revision }}</p>
      <p class="text-xs text-gray-500">Read the summary, try it in the preview, then decide.</p>
      <!-- The Ethics checklist (ETH-4): what the check found, high first, each linked to its line. -->
      <div class="rounded-lg bg-surface p-3 ring-1 ring-gray-200">
        <p class="text-sm font-medium text-ink">Ethics checklist</p>
        <p v-if="!ethics.length" class="mt-1 text-sm text-gray-600">It asks for no protected attribute (gender, caste, religion, colour, nationality, region, mother tongue, disability, age or marital status) and decides by none.</p>
        <ul v-else class="mt-1.5 space-y-1.5">
          <li v-for="(p, i) in ethics" :key="i" class="flex items-start gap-2 text-sm">
            <span :class="p.ethics!.severity === 'high' ? 'shrink-0 rounded-full bg-warning/25 px-2.5 py-1 text-[11px] font-semibold text-ink' : 'chip shrink-0 text-[11px]'">{{ p.ethics!.severity === "high" ? "Decides by it" : "Asks for it" }}</span>
            <button type="button" class="min-w-0 text-left text-ink hover:underline" @click="goToLine(p.line)">{{ p.message.replace(/^Ethics: /, "") }} <span class="text-gray-500">(line {{ p.line }})</span></button>
          </li>
        </ul>
        <p v-if="ethicsHigh" class="mt-2 text-xs text-gray-700">It treats people differently. Accept it only for a lawful purpose (a women's hostel, a senior citizens' discount, reserved scholarships), and write that reason in the note.</p>
      </div>
      <textarea v-model="reviewNote" class="input min-h-16" maxlength="1000" :placeholder="ethicsHigh ? 'The lawful purpose (needed to accept), or what to change (needed to reject)' : 'A note for the author (needed to reject)'" aria-label="Review note" />
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" :disabled="busy || (ethicsHigh > 0 && !reviewNote.trim())" :title="ethicsHigh && !reviewNote.trim() ? 'Write the lawful purpose in the note first' : undefined" @click="review('accept')"><Check class="size-4" aria-hidden="true" /> Accept and publish</button>
        <button type="button" class="btn-light" :disabled="busy || !reviewNote.trim()" @click="review('reject')"><X class="size-4" aria-hidden="true" /> Reject</button>
      </div>
    </form>
  </section>
</template>
