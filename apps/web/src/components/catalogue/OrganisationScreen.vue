<script setup lang="ts">
// The catalogue's Organisation screen (ORG-1..2): the published organisation, or the one being
// designed, and, for an administrator with none yet, the templates for this edition (or a blank
// one). A template creates the organisation and its starter services as drafts, in one step.
import type { LibraryEntry, LibraryPermissions } from "@sekaran-ind/yaxb-core/library";
import { compileOrganisation, parseDocument } from "@sekaran-ind/yaxb-journeys";
import { Building2, Loader2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import OrganisationView from "./OrganisationView.vue";
import EntryStatus from "./EntryStatus.vue";
import { catalogue, publishedOrganisation } from "@/composables/library";
import { api } from "@/lib/api";

const props = defineProps<{ entries: readonly LibraryEntry[]; can: LibraryPermissions }>();
const emit = defineEmits<{ open: [id: string]; changed: [] }>();

type Template = { id: string; edition: string; title: string; summary: string; services: number };
const templates = ref<Template[]>([]);
const busy = ref<string | null>(null);
const error = ref<string | null>(null);

const entry = computed(() => props.entries.find((e) => e.kind === "organisation" && e.status !== "archived") ?? null);
/** What to show: the published organisation, else the entry's latest revision. */
const shown = computed(() => {
  if (publishedOrganisation.value) return publishedOrganisation.value;
  if (!entry.value) return null;
  const p = parseDocument(entry.value.yaml);
  const r = p.ok ? compileOrganisation(p.doc) : null;
  return r?.ok ? r.organisation : null;
});

watch(
  () => props.can.manage && !entry.value,
  async (offer) => {
    if (!offer || templates.value.length) return;
    try {
      templates.value = (await api<{ templates: Template[] }>("/api/library/templates")).templates;
    } catch (e) {
      error.value = (e as Error).message;
    }
  },
  { immediate: true },
);

async function use(id: string) {
  busy.value = id;
  error.value = null;
  try {
    const r = await api<{ created: LibraryEntry[] }>(`/api/library/templates/${id}`, {});
    emit("changed");
    const org = r.created.find((e) => e.kind === "organisation");
    if (org) emit("open", org.id);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}

const BLANK = `kind: organisation
id: our-organisation
title: Our organisation
type: business
units:
  - id: office
    title: Office
    lead: owner
    roles: [{ id: owner, label: Owner }]
`;
async function blank() {
  busy.value = "blank";
  error.value = null;
  try {
    const r = await api<{ entry: LibraryEntry }>("/api/library/services", { yaml: BLANK });
    emit("changed");
    emit("open", r.entry.id);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <section aria-label="Organisation" class="max-w-4xl space-y-4">
    <p class="text-sm text-gray-600">
      Who is where: units, their roles, who reports to whom, and the services each unit runs. A journey screen for "the requester's manager" uses it to reach the right person. It is reviewed and published like a service.
    </p>
    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>

    <template v-if="entry">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold text-ink">{{ entry.title }}</span>
        <EntryStatus :status="entry.status" />
        <span v-if="publishedOrganisation && entry.status !== 'accepted'" class="text-xs text-gray-500">Showing the published revision; the latest is not published yet.</span>
        <button type="button" class="btn-light ml-auto h-9 text-sm" @click="emit('open', entry.id)">{{ can.manage ? "Open to change" : "Open" }}</button>
      </div>
      <OrganisationView v-if="shown" :organisation="shown" :services="catalogue" />
      <p v-else class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">The latest revision has problems. Open it to fix them.</p>
    </template>

    <template v-else-if="publishedOrganisation">
      <OrganisationView :organisation="publishedOrganisation" :services="catalogue" />
    </template>

    <template v-else-if="can.manage">
      <p class="text-sm font-medium text-ink">Start from a template</p>
      <ul class="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3">
        <li v-for="t in templates" :key="t.id" class="card flex flex-col gap-2 p-4">
          <span class="flex items-center gap-2 font-semibold text-ink"><Building2 class="size-4 text-gray-400" aria-hidden="true" />{{ t.title }}</span>
          <span class="text-sm text-gray-600">{{ t.summary }}</span>
          <span class="text-xs text-gray-500">{{ t.services }} starter service{{ t.services === 1 ? "" : "s" }}, as drafts</span>
          <button type="button" class="btn-light mt-auto h-9 text-sm" :disabled="busy !== null" @click="use(t.id)">
            <Loader2 v-if="busy === t.id" class="size-4 animate-spin" aria-hidden="true" /> Use this template
          </button>
        </li>
      </ul>
      <button type="button" class="btn-ghost" :disabled="busy !== null" @click="blank">Start with a blank organisation</button>
    </template>

    <p v-else class="rounded-lg bg-mist px-4 py-3 text-sm text-gray-600">No organisation is published yet. An administrator sets it up here.</p>
  </section>
</template>
