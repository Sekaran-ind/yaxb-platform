<script setup lang="ts">
// The Legal Guardian in the Service Catalogue (CON-1..5): the service's consent forms, one per role,
// drafted from what the service really does (what it asks, who sees it, where it is kept) and, with
// a model, put in plainer words. What a reviewer should look at shows as flags. "Use these forms"
// writes them into the service's `consent:` block, so they are reviewed with the service.
import { consentFacts, guardianFlags, type GuardianFlag } from "@sekaran-ind/yaxb-core/guardian";
import { parseDocument, serviceConsent, toYaml, type ConsentForm, type ServiceConsent } from "@sekaran-ind/yaxb-journeys";
import { AlertTriangle, Info, Loader2, Plus, Scale, Trash2, XCircle } from "@lucide/vue";
import { computed, ref } from "vue";
import { effectiveSelection, settings, useProviders } from "@/composables/settings";
import { api } from "@/lib/api";
import { roleLabel, type Role } from "@sekaran-ind/yaxb-journeys";

const props = defineProps<{ editable: boolean; storage: "none" | "box" | "server"; roles: readonly Role[] }>();
const yaml = defineModel<string>({ required: true });

const parsed = computed(() => parseDocument(yaml.value));
const current = computed<ServiceConsent | null>(() => (parsed.value.ok ? serviceConsent(parsed.value.doc.consent, null) : null));
/** The flags, worked out here as the service changes (the same rules the Guardian uses). */
const flags = computed<GuardianFlag[]>(() => (parsed.value.ok ? guardianFlags(consentFacts(parsed.value.doc, { storage: props.storage, roles: props.roles })) : []));
const roleName = (id: string) => (id === "visitor" ? "Anyone starting" : roleLabel(id, props.roles));

const { data: catalog } = useProviders();
const selection = computed(() => effectiveSelection(settings, catalog.value));
const draft = ref<ServiceConsent | null>(null);
const via = ref<"assistant" | "draft" | null>(null);
const note = ref<string | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

async function ask() {
  busy.value = true;
  error.value = note.value = null;
  try {
    const r = await api<{ consent: ServiceConsent; via: "assistant" | "draft"; note: string | null }>("/api/library/consent", { yaml: yaml.value, storage: props.storage, ...(selection.value ?? {}) });
    draft.value = JSON.parse(JSON.stringify(r.consent)) as ServiceConsent;
    via.value = r.via;
    note.value = r.note;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const editCurrent = () => ((draft.value = JSON.parse(JSON.stringify(current.value)) as ServiceConsent), (via.value = null), (note.value = null));

/** Write the forms into the service (a new version when the wording changed). */
function use() {
  if (!draft.value || !parsed.value.ok) return;
  const forms = draft.value.forms.map((f) => ({ ...f, title: f.title.trim(), agree: f.agree.trim() || "I agree", points: f.points.map((p) => p.trim()).filter(Boolean) })).filter((f) => f.points.length);
  const problems: string[] = [];
  const same = current.value && JSON.stringify(current.value.forms) === JSON.stringify(forms);
  const consent = { version: same ? current.value!.version : Math.max(draft.value.version, (current.value?.version ?? 0) + 1), forms };
  serviceConsent(consent, null, problems);
  if (problems.length) return void (error.value = problems.join(" "));
  yaml.value = toYaml({ ...parsed.value.doc, consent });
  draft.value = null;
  error.value = null;
}
function removeAll() {
  if (!parsed.value.ok) return;
  const { consent: _, ...rest } = parsed.value.doc;
  yaml.value = toYaml(rest);
}
const addPoint = (f: ConsentForm) => f.points.push("");
const icon = (l: GuardianFlag["level"]) => (l === "error" ? XCircle : l === "warning" ? AlertTriangle : Info);
</script>

<template>
  <section class="space-y-4" aria-labelledby="consent-title">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 id="consent-title" class="flex items-center gap-2 text-base font-semibold text-ink"><Scale class="size-4 text-brand" aria-hidden="true" /> Consent</h3>
        <p class="text-sm text-gray-600">The Legal Guardian writes a short consent form for each role from what this service asks, who sees it and where it is kept. People agree before they start or take part; the reviewer accepts the forms with the service.</p>
      </div>
      <button v-if="editable" type="button" class="btn-primary h-10 shrink-0" :disabled="busy || !parsed.ok" @click="ask">
        <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Scale v-else class="size-4" aria-hidden="true" />
        {{ current ? "Ask the Legal Guardian again" : "Ask the Legal Guardian" }}
      </button>
    </div>
    <p v-if="!parsed.ok" class="caution px-3 py-2 text-sm">Fix the YAML first: {{ parsed.error }}</p>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>

    <div v-if="flags.length" class="space-y-1.5">
      <h4 class="eyebrow">For the reviewer</h4>
      <ul class="space-y-1.5">
        <li v-for="(f, i) in flags" :key="i" :class="['flex items-start gap-2 rounded-xl px-3 py-2 text-sm', f.level === 'error' ? 'bg-red-50 text-red-800' : f.level === 'warning' ? 'caution' : 'bg-mist text-body']">
          <component :is="icon(f.level)" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span><strong v-if="f.role" class="font-medium">{{ roleName(f.role) }}: </strong>{{ f.message }}</span>
        </li>
      </ul>
    </div>

    <!-- A draft to check and change -->
    <div v-if="draft" class="space-y-3">
      <p class="text-sm text-gray-600">{{ via === "assistant" ? "The Legal Guardian's forms, in plain words. Check every point, change what you need, then use them." : via === "draft" ? "Drafted from the service. Check every point, change what you need, then use them." : "Change the forms, then use them." }}<template v-if="note"> {{ note }}</template></p>
      <div v-for="f in draft.forms" :key="f.role" class="card space-y-2 p-4">
        <p class="eyebrow">{{ roleName(f.role) }}</p>
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Title</span><input v-model="f.title" class="input" maxlength="80" /></label>
        <ol class="space-y-2">
          <li v-for="(_, i) in f.points" :key="i" class="flex items-start gap-2">
            <span class="mt-2.5 w-5 shrink-0 text-right text-xs text-gray-500">{{ i + 1 }}.</span>
            <textarea v-model="f.points[i]" class="input min-h-16 flex-1" maxlength="300" :aria-label="`${roleName(f.role)}: point ${i + 1}`" />
            <button type="button" class="btn-ghost mt-1 size-9 shrink-0 p-0" :aria-label="`Remove point ${i + 1}`" @click="f.points.splice(i, 1)"><Trash2 class="size-4" aria-hidden="true" /></button>
          </li>
        </ol>
        <div class="flex flex-wrap items-end justify-between gap-2">
          <button v-if="f.points.length < 8" type="button" class="btn-ghost h-9 px-2 text-sm" @click="addPoint(f)"><Plus class="size-4" aria-hidden="true" /> Add a point</button>
          <label class="text-sm"><span class="mb-1 block font-medium text-ink">Agree button</span><input v-model="f.agree" class="input w-56" maxlength="60" /></label>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary h-10" @click="use">Use these forms</button>
        <button type="button" class="btn-light h-10" @click="draft = null">Cancel</button>
      </div>
    </div>

    <!-- The forms as people will see them -->
    <div v-else-if="current" class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-gray-600">Version {{ current.version }}. A new version asks people to agree again.</p>
        <div v-if="editable" class="flex gap-2">
          <button type="button" class="btn-light h-9 text-sm" @click="editCurrent">Change</button>
          <button type="button" class="btn-ghost h-9 text-sm" @click="removeAll">Remove</button>
        </div>
      </div>
      <div class="grid gap-3 @2xl:grid-cols-2">
        <article v-for="f in current.forms" :key="f.role" class="card p-4">
          <p class="eyebrow">{{ roleName(f.role) }}</p>
          <h4 class="mt-1 font-semibold text-ink">{{ f.title }}</h4>
          <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-body">
            <li v-for="(p, i) in f.points" :key="i">{{ p }}</li>
          </ul>
          <p class="mt-3 inline-flex rounded-full bg-brand-dark px-3 py-1 text-xs text-on-brand">{{ f.agree }}</p>
        </article>
      </div>
    </div>
    <p v-else class="rounded-xl bg-mist px-4 py-3 text-sm text-gray-600">No consent forms yet. {{ editable ? "Ask the Legal Guardian to write them." : "Its designer can ask the Legal Guardian to write them." }}</p>
  </section>
</template>
