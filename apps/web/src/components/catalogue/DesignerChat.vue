<script setup lang="ts">
// The Service Designer as a conversation (LIB-39..41): a thread kept with the service. The first
// message of a new service describes it and the agent drafts it; every later message, on a new
// service or any saved one, asks for a change to what is in the editor now, so the context stays.
// Its drafts go into the editor for those who may change the service (with Undo); a reviewer of a
// service in review gets suggestions, which its author can apply from the same thread.
import type { DesignMessage } from "@sekaran-ind/yaxb-core/designer";
import { Bot, ChevronDown, Loader2, Send, Sparkles, Undo2 } from "@lucide/vue";
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
const open = ref(true);
const list = ref<HTMLElement | null>(null);
/** The message whose draft is in the editor, and what the editor held before it (Undo). */
const appliedId = ref<string | null>(null);
const before = ref<string | null>(null);

async function load() {
  error.value = null;
  messages.value = [];
  appliedId.value = before.value = null;
  if (!props.entryId && !props.threadId) {
    open.value = true;
    return;
  }
  try {
    const q = props.entryId ? `entry=${encodeURIComponent(props.entryId)}` : `thread=${encodeURIComponent(props.threadId!)}`;
    const r = await api<{ messages: DesignMessage[]; mayTalk: boolean; applies: boolean }>(`/api/library/design?${q}`);
    messages.value = r.messages;
    mayTalk.value = r.mayTalk;
    applies.value = r.applies;
    // A saved service opens with its conversation folded, unless it has one.
    open.value = !props.entryId || r.messages.length > 0;
    scrollDown();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(() => [props.entryId, props.threadId], load, { immediate: true });

const first = computed(() => !props.entryId && !messages.value.length && props.pristine);
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
  if (!sel || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const r = await api<{ yaml: string; ok: boolean; run: string; thread: string; messages: DesignMessage[]; applies: boolean }>("/api/library/design", {
      narrative: text.value,
      provider: sel.provider,
      model: sel.model,
      ...(props.entryId ? { entry: props.entryId } : props.threadId ? { thread: props.threadId } : {}),
      ...(first.value ? {} : { current: props.yaml }),
    });
    text.value = "";
    messages.value = [...messages.value, ...r.messages];
    if (!props.entryId) emit("thread", r.thread);
    applies.value = r.applies;
    const reply = r.messages.at(-1);
    if (r.applies && reply?.yaml) apply(reply);
    scrollDown();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
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
  <section aria-labelledby="designer-chat" class="@container rounded-2xl bg-mist p-3">
    <button id="designer-chat" type="button" class="flex w-full items-center gap-2 text-left text-sm font-medium text-ink" :aria-expanded="open" @click="open = !open">
      <Sparkles class="size-4 text-brand" aria-hidden="true" />
      <span class="flex-1">{{ first ? "Describe the service in your own words" : "Service Designer conversation" }}<span v-if="messages.length" class="text-gray-500"> · {{ messages.length / 2 }} turn{{ messages.length === 2 ? "" : "s" }}</span></span>
      <ChevronDown :class="['size-4 transition-transform', open ? 'rotate-180' : '']" aria-hidden="true" />
    </button>

    <div v-if="open" class="mt-2 space-y-2">
      <p class="text-xs text-gray-600">
        <template v-if="first">Who uses it, what they do, what it asks for, and who approves or finishes it. The AI drafts the service; you check and change it in the steps below, and a reviewer publishes it.</template>
        <template v-else-if="editable">Ask for changes in your own words. The AI changes the design in the editor and keeps the rest; its reviewers see this conversation too.</template>
        <template v-else>Suggest changes in your own words. Its designer sees them here and can apply them.</template>
      </p>

      <ol v-if="messages.length" ref="list" class="max-h-[60vh] space-y-2 overflow-y-auto pr-1 @lg:max-h-96" aria-label="Conversation">
        <!-- Narrow, the bubbles use the full width; from @lg they lean left (the AI) and right (people). -->
        <li v-for="m in messages" :key="m.id" :class="m.role === 'user' ? 'rounded-xl bg-surface px-3 py-2 ring-1 ring-gray-200 @lg:ml-10' : 'rounded-xl bg-canvas px-3 py-2 @lg:mr-10'">
          <p class="flex items-center gap-1.5 text-xs text-gray-500">
            <Bot v-if="m.role === 'assistant'" class="size-3.5 text-brand" aria-hidden="true" /><span class="font-medium text-ink">{{ m.author_name }}</span> · {{ when(m.created_at) }}
          </p>
          <p class="mt-0.5 text-sm whitespace-pre-wrap text-ink">{{ m.text }}</p>
          <div v-if="m.role === 'assistant' && m.yaml" class="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <template v-if="appliedId === m.id">
              <span class="text-success">In the editor now.</span>
              <button type="button" class="btn-ghost h-7 px-2 text-xs" @click="undo"><Undo2 class="size-3.5" aria-hidden="true" /> Undo</button>
            </template>
            <button v-else-if="editable" type="button" class="btn-light h-7 px-2 text-xs" @click="apply(m)">Put this draft in the editor</button>
            <span v-else class="text-gray-500">A suggestion for its designer.</span>
            <span v-if="m.ok === false" class="text-red-800">It has problems to fix.</span>
          </div>
        </li>
      </ol>

      <form v-if="mayTalk" class="space-y-2" @submit.prevent="send">
        <label for="designer-message" :class="first ? 'sr-only' : 'block text-sm font-medium text-ink'">{{ first ? "Describe the service" : editable ? "Ask for a change" : "Suggest a change" }}</label>
        <textarea
          id="designer-message"
          v-model="text"
          class="input"
          :class="first ? 'min-h-28' : 'min-h-16'"
          :maxlength="MAX_NARRATIVE"
          :placeholder="placeholder"
          @keydown.enter.ctrl.prevent="send"
        />
        <!-- The composer's row: the help on the left, the send button on the right (patterns: a conversation). -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span v-if="busy" role="status" class="text-xs text-gray-600">This can take a minute.</span>
          <span v-else-if="!selection" class="text-xs text-gray-600">This needs an AI model, and this server has none set up. Design it step by step below.</span>
          <span v-else-if="first && text.trim().length < 20" class="text-xs text-gray-600">Write a few sentences first, or design it step by step below.</span>
          <span v-else-if="first" class="text-xs text-gray-600">{{ text.length }} / {{ MAX_NARRATIVE }}</span>
          <span v-else class="hidden text-xs text-gray-600 @lg:inline">Ctrl+Enter sends.</span>
          <button type="submit" class="btn-primary ml-auto" :disabled="busy || !selection || text.trim().length < minLength">
            <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Send v-else class="size-4" aria-hidden="true" />
            {{ busy ? (first ? "Drafting…" : "Working on it…") : first ? "Draft it with AI" : "Send" }}
          </button>
        </div>
      </form>
      <p v-else class="text-xs text-gray-600">Only its designer or an editor, or a reviewer while it is in review, can talk to the Service Designer about it.</p>
      <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    </div>
  </section>
</template>
