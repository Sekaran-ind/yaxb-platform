<script setup lang="ts">
// The Service Designer as a conversation (LIB-39..41): a chat thread kept with the service, read
// like the kiosk's (the person on the right, the designer on the left, one message box at the foot).
// The first message of a new service describes it and the agent drafts it; every later message asks
// for a change to what is in the editor now. The server sends the thread's earlier turns and the
// editor's YAML with every message, and the designer agent compacts a long thread, so the context stays.
// Its drafts go into the editor for those who may change the service (with Undo); a reviewer of a
// service in review gets suggestions, which its author can apply from the same thread.
import type { DesignMessage } from "@sekaran-ind/yaxb-core/designer";
import { ArrowUp, Bot, Loader2, Sparkles, Undo2 } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { effectiveSelection, settings, useProviders } from "@/composables/settings";
import { api } from "@/lib/api";

const MAX_NARRATIVE = 4000;
const props = defineProps<{
  /** The saved service, or null for a new one. */
  entryId: string | null;
  /** The new service's thread (kept by the workspace across reloads). */
  threadId: string | null;
  /** The YAML in the editor now. */
  yaml: string;
  /** The editor still holds the untouched starter: the first message describes the service. */
  pristine: boolean;
  /** This person can change the service (else: a reviewer, who gets suggestions). */
  editable: boolean;
  /** A description to start the first message with (the home page's ideas, `?idea=`); never sent until the person sends it. */
  idea?: string;
}>();
const emit = defineEmits<{ apply: [yaml: string, run: string | null]; thread: [id: string] }>();

const { data: catalog } = useProviders();
const selection = computed(() => effectiveSelection(settings, catalog.value));
const messages = ref<DesignMessage[]>([]);
const mayTalk = ref(true);
const applies = ref(true);
const text = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const list = ref<HTMLElement | null>(null);
const box = ref<HTMLTextAreaElement | null>(null);
/** The message being sent, shown at once while the designer works on it. */
const sending = ref<string | null>(null);
/** The message whose draft is in the editor, and what the editor held before it (Undo). */
const appliedId = ref<string | null>(null);
const before = ref<string | null>(null);

async function load() {
  error.value = null;
  messages.value = [];
  appliedId.value = before.value = null;
  if (!props.entryId && !props.threadId) return;
  try {
    const q = props.entryId ? `entry=${encodeURIComponent(props.entryId)}` : `thread=${encodeURIComponent(props.threadId!)}`;
    const r = await api<{ messages: DesignMessage[]; mayTalk: boolean; applies: boolean }>(`/api/library/design?${q}`);
    messages.value = r.messages;
    mayTalk.value = r.mayTalk;
    applies.value = r.applies;
    scrollDown();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
/** The thread this chat started itself: when the workspace hands it back, there is nothing to reload. */
let started: string | null = null;
watch(
  () => [props.entryId, props.threadId] as const,
  ([entry, thread]) => {
    if (!entry && thread && thread === started) return;
    void load();
  },
  { immediate: true },
);

const first = computed(() => !props.entryId && !messages.value.length && props.pristine);
// An idea fills an empty first message once; the person reads it, changes it, then sends it.
watch(
  () => [props.idea, first.value] as const,
  ([idea, isFirst]) => {
    if (idea && isFirst && !text.value) text.value = idea.slice(0, MAX_NARRATIVE);
  },
  { immediate: true },
);
const minLength = computed(() => (first.value ? 20 : 2));
const placeholder = computed(() =>
  first.value
    ? "e.g. Runners register for our marathon: name, distance and T-shirt size. An organiser approves each entry, then a marshal gives out the bib."
    : props.editable
      ? "e.g. Let the organiser approve each entry first."
      : "e.g. Ask for the T-shirt size before the distance.",
);

function scrollDown() {
  void nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight }));
}

async function send() {
  const sel = selection.value;
  if (!sel || busy.value || text.value.trim().length < minLength.value) return;
  busy.value = true;
  error.value = null;
  sending.value = text.value.trim();
  const said = text.value;
  text.value = "";
  grow();
  scrollDown();
  try {
    const r = await api<{ yaml: string; ok: boolean; run: string; thread: string; messages: DesignMessage[]; applies: boolean }>("/api/library/design", {
      narrative: said,
      provider: sel.provider,
      model: sel.model,
      ...(props.entryId ? { entry: props.entryId } : props.threadId ? { thread: props.threadId } : {}),
      ...(first.value ? {} : { current: props.yaml }),
    });
    messages.value = [...messages.value, ...r.messages];
    if (!props.entryId) {
      started = r.thread;
      emit("thread", r.thread);
    }
    applies.value = r.applies;
    const reply = r.messages.at(-1);
    if (r.applies && reply?.yaml) apply(reply);
    scrollDown();
  } catch (e) {
    error.value = (e as Error).message;
    // Nothing was kept: the words go back into the box to send again.
    if (!text.value) text.value = said;
  } finally {
    busy.value = false;
    sending.value = null;
    grow();
  }
}

/** The message box grows with its words, up to about six lines. */
function grow() {
  void nextTick(() => {
    const el = box.value;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  });
}
watch(text, grow);
/** Enter sends; Shift+Enter starts a new line. */
function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
}

function apply(m: DesignMessage) {
  if (!m.yaml || !props.editable) return;
  before.value = props.yaml;
  appliedId.value = m.id;
  emit("apply", m.yaml, m.run_id);
}
function undo() {
  if (before.value === null) return;
  emit("apply", before.value, null);
  before.value = appliedId.value = null;
}
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
</script>

<template>
  <section aria-labelledby="designer-chat" class="@container flex flex-col rounded-2xl bg-mist p-3">
    <h3 id="designer-chat" class="flex items-center gap-2 text-sm font-medium text-ink">
      <Sparkles class="size-4 text-brand" aria-hidden="true" /> Service Designer
      <span v-if="messages.length" class="font-normal text-gray-500">· {{ messages.length / 2 }} turn{{ messages.length === 2 ? "" : "s" }}</span>
    </h3>

    <div ref="list" class="mt-2 max-h-[60vh] min-h-24 space-y-4 overflow-y-auto px-1 py-2 @lg:max-h-[28rem]" aria-live="polite">
      <!-- The empty thread says what to write, as the kiosk's does. -->
      <div v-if="!messages.length && !sending" class="py-4 text-center">
        <p class="font-medium text-ink">{{ first ? "Describe the service in your own words." : editable ? "Ask for a change in your own words." : "Suggest a change in your own words." }}</p>
        <p class="mx-auto mt-1 max-w-prose text-sm text-gray-600">
          <template v-if="first">Who uses it, what they do, what it asks for, and who approves or finishes it. The AI drafts it; you check it in the steps below, and a reviewer publishes it.</template>
          <template v-else-if="editable">The AI changes the design in the editor and keeps the rest. Reviewers see this conversation too.</template>
          <template v-else>Its designer sees your suggestions here and can apply them.</template>
        </p>
      </div>

      <template v-for="m in messages" :key="m.id">
        <div v-if="m.role === 'user'" class="flex flex-col items-end gap-1">
          <p class="max-w-[85%] rounded-3xl rounded-br-lg bg-brand-dark px-4 py-2.5 text-sm whitespace-pre-wrap text-on-brand">{{ m.text }}</p>
          <p class="text-[11px] text-gray-500">{{ m.author_name }} · {{ when(m.created_at) }}</p>
        </div>
        <div v-else class="flex gap-3">
          <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface text-ink ring-1 ring-gray-200"><Bot class="size-3.5 text-brand" aria-hidden="true" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-sm whitespace-pre-wrap text-ink">{{ m.text }}</p>
            <div v-if="m.yaml" class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <template v-if="appliedId === m.id">
                <span class="text-success">In the editor now.</span>
                <button type="button" class="btn-ghost h-7 px-2 text-xs" @click="undo"><Undo2 class="size-3.5" aria-hidden="true" /> Undo</button>
              </template>
              <button v-else-if="editable" type="button" class="btn-light h-7 px-2 text-xs" @click="apply(m)">Put this draft in the editor</button>
              <span v-else class="text-gray-500">A suggestion for its designer.</span>
              <span v-if="m.ok === false" class="text-red-800">It has problems to fix.</span>
            </div>
            <p class="mt-1 text-[11px] text-gray-500">{{ when(m.created_at) }}</p>
          </div>
        </div>
      </template>

      <!-- The message just sent, and the designer working on it. -->
      <template v-if="sending">
        <div class="flex justify-end"><p class="max-w-[85%] rounded-3xl rounded-br-lg bg-brand-dark px-4 py-2.5 text-sm whitespace-pre-wrap text-on-brand">{{ sending }}</p></div>
        <div class="flex gap-3" role="status">
          <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-gray-200"><Bot class="size-3.5 text-brand" aria-hidden="true" /></span>
          <p class="flex items-center gap-2 text-sm text-gray-600"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> {{ first || !messages.length ? "Drafting the service. This can take a minute." : "Working on it. This can take a minute." }}</p>
        </div>
      </template>
    </div>

    <p v-if="error" role="alert" class="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>

    <form
      v-if="mayTalk"
      class="mt-1 flex items-end gap-1.5 rounded-[1.75rem] border border-gray-200 bg-surface py-1.5 pr-1.5 pl-4 transition focus-within:border-gray-400 focus-within:ring-4 focus-within:ring-brand/15"
      @submit.prevent="send"
    >
      <label for="designer-message" class="sr-only">{{ first ? "Describe the service" : editable ? "Ask for a change" : "Suggest a change" }}</label>
      <textarea
        id="designer-message"
        ref="box"
        v-model="text"
        rows="1"
        class="max-h-42 min-w-0 flex-1 resize-none self-center bg-transparent py-2 text-ink outline-none placeholder:text-gray-400"
        :maxlength="MAX_NARRATIVE"
        :placeholder="placeholder"
        :disabled="!selection"
        @keydown="onKey"
      />
      <button type="submit" class="btn-primary size-10 shrink-0 p-0" :disabled="busy || !selection || text.trim().length < minLength" :aria-label="first ? 'Draft it with AI' : 'Send'" :title="first ? 'Draft it with AI' : 'Send'">
        <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" />
        <ArrowUp v-else class="size-4" aria-hidden="true" />
      </button>
    </form>
    <p v-if="mayTalk" class="mt-1.5 text-center text-[11px] text-gray-500">
      <template v-if="!selection">This needs an AI model, and this server has none set up. Design it step by step below.</template>
      <template v-else-if="first && text.trim().length < 20">Write a few sentences, or design it step by step below. Enter sends; Shift+Enter starts a new line.</template>
      <template v-else>Enter sends; Shift+Enter starts a new line.<span v-if="first"> {{ text.length }} / {{ MAX_NARRATIVE }}</span></template>
    </p>
    <p v-else class="mt-2 text-xs text-gray-600">Only its designer or an editor, or a reviewer while it is in review, can talk to the Service Designer about it.</p>
  </section>
</template>
