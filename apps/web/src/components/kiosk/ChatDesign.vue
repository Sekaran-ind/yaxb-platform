<script setup lang="ts">
// A service designed in the conversation (LIB-64): Ask Me is where a new service starts. The design
// (`session`) takes the message box's words while it is open, like a form does (form-input.ts): the
// first message describes the service, every later one asks for a change. The Service Designer's
// replies (`reply`) show its draft: what it is called, its journeys and screens, and its problems.
// The latest draft can be created in the catalogue as a draft service, or opened in the full
// designer (Design, YAML, Preview, Flow), where the same thread carries on.
import { compileBundle } from "@sekaran-ind/yaxb-journeys";
import { JOURNEY_SERVICES } from "@sekaran-ind/yaxb-core/content";
import type { LibraryEntry } from "@sekaran-ind/yaxb-core/library";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, PencilRuler, Plus, Sparkles, X } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { offerFormInput, withdrawFormInput } from "@/composables/form-input";
import { api } from "@/lib/api";
import type { DesignTurn } from "@/lib/types";

type Session = Extract<DesignTurn, { kind: "session" }>;
const props = defineProps<{
  turnId: string;
  design: DesignTurn;
  /** For a reply: the design it belongs to. */
  session?: Session | null;
  /** Its place in the conversation: the newest open form or design takes the words. */
  order: number;
}>();
const emit = defineEmits<{ say: [sessionId: string, text: string]; update: [turnId: string, patch: Partial<DesignTurn>]; sessionUpdate: [patch: Partial<Session>] }>();
const router = useRouter();

// ---- the design: the message box's words go to the designer while it is open ----------------------
const formId = computed(() => `design-${props.turnId}`);
watch(
  () => props.design.kind === "session" && props.design.status === "designing",
  (open) => {
    if (open) offerFormInput({ id: formId.value, label: "the new service", order: props.order, fill: async (text) => emit("say", props.turnId, text) });
    else withdrawFormInput(formId.value);
  },
  { immediate: true },
);
onBeforeUnmount(() => withdrawFormInput(formId.value));

// ---- a reply's draft ------------------------------------------------------------------------------
const draft = computed(() => (props.design.kind === "reply" && props.design.yaml ? compileBundle(props.design.yaml, { services: JOURNEY_SERVICES }) : null));
const journeys = computed(() => draft.value?.journeys.map((j) => ({ id: j.id, title: j.title, screens: Object.values(j.steps).filter((s) => s.ask !== undefined).length })) ?? []);
/** Only the draft the design holds now can be created or opened. */
const latest = computed(() => props.design.kind === "reply" && Boolean(props.design.yaml) && props.session?.yaml === props.design.yaml);
const created = computed(() => props.session?.status === "created" && props.session.entry);

const busy = ref(false);
const error = ref<string | null>(null);
async function create() {
  if (props.design.kind !== "reply" || !props.design.yaml || !props.session) return;
  busy.value = true;
  error.value = null;
  try {
    const r = await api<{ entry: LibraryEntry }>("/api/library/services", {
      yaml: props.design.yaml,
      ...(props.design.run ? { design: props.design.run } : {}),
      ...(props.session.thread ? { thread: props.session.thread } : {}),
    });
    emit("sessionUpdate", { status: "created", entry: r.entry.id, title: r.entry.title });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
/** The full designer: the created entry, or the draft handed over as the catalogue's unsaved service. */
function openDesigner() {
  const s = props.session ?? (props.design.kind === "session" ? props.design : null);
  if (!s) return;
  if (s.entry) return void router.push({ path: "/catalogue", query: { service: s.entry } });
  try {
    localStorage.setItem("yaxb.catalogue.unsaved", JSON.stringify({ yaml: s.yaml ?? "", thread: s.thread, run: s.run }));
  } catch {
    /* private mode: the designer starts empty */
  }
  void router.push({ path: "/catalogue", query: { service: "new" } });
}
</script>

<template>
  <!-- The design: what it is, and how to talk to it. -->
  <div v-if="design.kind === 'session'" class="card space-y-2 p-4 text-sm" role="group" aria-label="Designing a new service">
    <div class="flex flex-wrap items-center gap-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-full bg-brand/15 text-ink"><Sparkles class="size-4" aria-hidden="true" /></span>
      <span class="min-w-0 flex-1">
        <span class="block font-medium text-ink">{{ design.title ?? "A new service" }}</span>
        <span class="block text-xs text-gray-500">{{
          design.status === "created" ? "Created in the catalogue as a draft." : design.status === "stopped" ? "Designing stopped." : design.yaml ? "Ask for changes in the message box below." : "Describe the service in the message box below: who uses it, what they do, who answers."
        }}</span>
      </span>
      <button v-if="design.status === 'created' || design.yaml" type="button" class="btn-light h-9 px-3 text-sm" @click="openDesigner"><PencilRuler class="size-4" aria-hidden="true" /> Open in the designer</button>
      <button v-if="design.status === 'designing'" type="button" class="btn-ghost h-9 px-2 text-sm" @click="emit('update', turnId, { status: 'stopped' })"><X class="size-4" aria-hidden="true" /> Stop</button>
      <button v-else-if="design.status === 'stopped'" type="button" class="btn-ghost h-9 px-2 text-sm" @click="emit('update', turnId, { status: 'designing' })">Carry on</button>
    </div>
    <!-- An idea from the home page: offered, never sent until the person taps it. -->
    <div v-if="design.status === 'designing' && !design.yaml && design.idea" class="space-y-2 rounded-lg bg-mist px-3 py-2">
      <p class="text-ink">“{{ design.idea }}”</p>
      <button type="button" class="btn-light h-9 px-3 text-sm" @click="emit('say', turnId, design.idea)"><Sparkles class="size-4" aria-hidden="true" /> Design this</button>
    </div>
    <p v-else-if="design.status === 'designing' && !design.yaml" class="text-xs text-gray-500">
      e.g. “Runners register for our marathon: name, distance and T-shirt size. An organiser approves each entry, then a marshal gives out the bib.”
    </p>
  </div>

  <!-- The designer's reply, with its draft. -->
  <div v-else class="max-w-[92%] space-y-2">
    <p v-if="design.pending" class="flex items-center gap-2 text-sm text-gray-600"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> The Service Designer is drafting…</p>
    <p v-else-if="design.failed" role="alert" class="caution px-3 py-2 text-sm">{{ design.failed }}</p>
    <template v-else>
      <p class="leading-relaxed whitespace-pre-wrap text-ink">{{ design.text }}</p>
      <div v-if="draft" class="card space-y-2 p-4 text-sm" :class="!latest && 'opacity-70'">
        <p class="flex flex-wrap items-center gap-2">
          <span class="font-semibold text-ink">{{ design.title ?? draft.services[0]?.title ?? "The draft" }}</span>
          <span v-if="design.errors" class="caution inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"><AlertTriangle class="size-3" aria-hidden="true" /> {{ design.errors }} problem{{ design.errors === 1 ? "" : "s" }}</span>
          <span v-else class="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 class="size-3" aria-hidden="true" /> No problems</span>
          <span v-if="!latest" class="chip text-xs">An earlier draft</span>
        </p>
        <p v-if="draft.roles.length" class="flex flex-wrap gap-1"><span v-for="r in draft.roles" :key="r.id" class="chip">{{ r.label }}</span></p>
        <ul class="space-y-0.5 text-gray-700">
          <li v-for="j in journeys" :key="j.id">{{ j.title }} <span class="text-xs text-gray-500">· {{ j.screens }} screen{{ j.screens === 1 ? "" : "s" }}</span></li>
        </ul>
        <div v-if="latest" class="flex flex-wrap gap-2 pt-1">
          <template v-if="created">
            <span class="inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 class="size-4" aria-hidden="true" /> Created as a draft</span>
            <button type="button" class="btn-light h-9 px-3 text-sm" @click="openDesigner"><ExternalLink class="size-4" aria-hidden="true" /> Open it</button>
          </template>
          <template v-else>
            <button type="button" class="btn-primary h-9 px-3 text-sm" :disabled="busy" @click="create"><Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Plus v-else class="size-4" aria-hidden="true" /> Create service</button>
            <button type="button" class="btn-light h-9 px-3 text-sm" @click="openDesigner"><PencilRuler class="size-4" aria-hidden="true" /> Open in the designer</button>
          </template>
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
      </div>
    </template>
  </div>
</template>
