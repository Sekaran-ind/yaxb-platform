<script setup lang="ts">
// The Transcript screen: ask box and the conversation with live agent activity. The composer also
// loads context into the conversation (LIB-49): + attaches files to the notebook and opens the
// context loader; /journeys and /staff slide up a list whose journeys run here, in the
// conversation; a request's reference (R-XXXXXX) shows where that request is. Journeys and
// references stay in the conversation, so opening it later shows where they are.
import { MAX_MESSAGE_CHARS } from "@sekaran-ind/yaxb-core/schemas";
import { ArrowUp, Bot, CheckCircle2, HardDrive, Circle, CircleDot, Inbox, ListChecks, Loader2, MessagesSquare, Mic, MicOff, Paperclip, Plus, RotateCcw, Settings2, ShieldCheck, UserRoundCog, Wrench } from "@lucide/vue";
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import { CASE_REF } from "@sekaran-ind/yaxb-core/cases";
import { ACCEPTED_FILES } from "@/lib/browser/documents";
import type { NotebookRecord, ThreadRecord } from "@/lib/browser/store";
import ThreadDrawer from "./ThreadDrawer.vue";
import { askInstead, formInput, openForm } from "@/composables/form-input";
import ChatJourney from "./ChatJourney.vue";
import ContextSheet from "./ContextSheet.vue";
import RequestCard from "./RequestCard.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { cn } from "@/lib/cn";
import AnswerText from "./AnswerText.vue";
import CommandCard from "./CommandCard.vue";
import type { ChatTurn, ContextPick, JourneyTurn, ProvidersResponse, ToolActivity } from "@/lib/types";

/** The person's turn for context they loaded: its icon, and words for a screen reader. */
const VIA = { journey: { icon: ListChecks, said: "Started a journey:" }, request: { icon: Inbox, said: "Checked a request:" }, file: { icon: Paperclip, said: "Attached:" } } as const;

const props = defineProps<{
  turns: ChatTurn[];
  busy: boolean;
  /** The pane's height: the conversation scrolls inside it, under the floating composer. */
  heightClass?: string;
  /** Voice input from the composer's microphone (the same as the console's). */
  listening?: boolean;
  voiceSupported?: boolean;
  selection: { provider: string; model: string } | null;
  /** Whether a question can be sent now (a provider, or on-device answers). */
  canAsk: boolean;
  /** An AI provider is available (for a command card's "ask the assistant"). */
  hasAssistant?: boolean;
  /** How questions are answered (Settings → Knowledge); "auto" has already fallen back to "local" without a provider. */
  answers: "agent" | "local" | "auto";
  catalog: ProvidersResponse | null;
  catalogError: string | null;
  notebookTitle: string | null;
  sourceCount: number;
  /** For journeys run in the conversation. */
  services: Record<string, ServiceHandler>;
  notebook: NotebookRecord | null;
  /** A signed-in member (offers /staff). */
  member?: boolean;
  /** The notebook's conversations, for the drawer, and the one open now. */
  threads: ThreadRecord[];
  activeThreadId: string;
}>();
/** card: a command card's button (yes, no, start, sign-in, ask-assistant) for the shell to carry out. */
const emit = defineEmits<{
  mic: [];
  ask: [question: string];
  reset: [];
  card: [turnId: string, action: "yes" | "no" | "start" | "sign-in" | "ask-assistant"];
  review: [turnId: string];
  /** Context loaded into the conversation: a journey, a request's reference, files for the notebook. */
  journey: [id: string, title: string];
  /** A request: `open` unfolds it (picked from /staff). */
  request: [ref: string, open?: boolean];
  attach: [files: File[]];
  journeyUpdate: [turnId: string, patch: Partial<JourneyTurn>];
  journeyDone: [journeyId: string];
  speak: [text: string];
  openThread: [id: string];
}>();
const drawer = ref(false);

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Searching the knowledge base",
  local_search: "Searching the knowledge base on this device",
  web_search: "Searching the web",
  list_knowledge_sources: "Checking knowledge sources",
  flag_for_moderation: "Escalating to a moderator",
  write_todos: "Planning",
  task: "Delegating",
  write_file: "Writing notes",
  edit_file: "Updating notes",
};
function toolLabel(t: ToolActivity) {
  if (t.name === "task" && t.subagent) return `Asking the ${t.subagent.replace(/-/g, " ")}`;
  if (t.name.startsWith("mcp_")) return `Using ${t.name.split("_")[1]}`;
  if (["read_file", "grep", "ls", "glob"].includes(t.name)) return "Reading the notebook";
  return TOOL_LABELS[t.name] ?? t.name;
}

const draft = ref("");
const end = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const provider = computed(() => props.catalog?.providers.find((p) => p.id === props.selection?.provider));
const modelLabel = computed(() => provider.value?.models.find((m) => m.id === props.selection?.model)?.label);
const noProvider = computed(() => props.answers !== "local" && props.catalog && !props.catalog.providers.some((p) => p.configured));

watch(
  () => props.turns.map((t) => t.text.length + t.tools.length).join(),
  async () => {
    await nextTick();
    // Keep the latest message in view above the floating composer.
    if (props.heightClass) scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: "smooth" });
    else end.value?.scrollIntoView({ behavior: "smooth", block: "end" });
  },
);
// A card that grows after it loads (a request's status, a journey's next screen) stays in view
// above the composer, as long as the reader was at the end of the conversation.
let atEnd = true;
const sizes = new ResizeObserver(() => {
  const el = scroller.value;
  if (el && props.heightClass && atEnd) el.scrollTo({ top: el.scrollHeight });
});
onMounted(() => {
  const el = scroller.value;
  if (!el) return;
  el.addEventListener("scroll", () => (atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 160), { passive: true });
  for (const child of Array.from(el.children)) sizes.observe(child);
  new MutationObserver(() => {
    sizes.disconnect();
    for (const child of Array.from(el.children)) sizes.observe(child);
  }).observe(el, { childList: true });
});
onBeforeUnmount(() => sizes.disconnect());

// ---- loading context: + and slash commands (LIB-49) ----------------------------------------------
const sheet = ref<"journeys" | "staff" | null>(null);
const menu = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const MENU_ITEM = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-ink outline-none hover:bg-mist focus-visible:bg-mist focus-visible:ring-2 focus-visible:ring-brand/40";
const SLASH = computed(() => [
  { cmd: "/journeys", label: "Start a journey here", icon: ListChecks },
  ...(props.member ? [{ cmd: "/staff", label: "Staff journeys and requests waiting for you", icon: UserRoundCog }] : []),
  { cmd: "/request", label: "Check a request by its reference", icon: Inbox },
]);
/** Slash suggestions while the message starts with "/". */
const suggestions = computed(() => (draft.value.startsWith("/") && !draft.value.includes(" ") ? SLASH.value.filter((s) => s.cmd.startsWith(draft.value.toLowerCase())) : []));
/** A reference typed on its own, or after /request. */
function referenceIn(text: string): string | null {
  const t = text.replace(/^\/request\s*/i, "").trim().toUpperCase();
  const ref = /^R-?[0-9A-Z]{6}$/.test(t) ? t.replace(/^R-?/, "R-") : null;
  return ref && CASE_REF.test(ref) ? ref : null;
}
const input = ref<HTMLInputElement | null>(null);
const plusButton = ref<HTMLButtonElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
/** The highlighted suggestion (arrow keys), and suggestions put away with Escape until the draft changes. */
const active = ref(0);
const dismissed = ref(false);
watch(draft, () => ((active.value = 0), (dismissed.value = false)));
const showSuggestions = computed(() => suggestions.value.length > 0 && !dismissed.value && !menu.value);

function runSlash(cmd: string) {
  draft.value = "";
  closeMenu(false);
  if (cmd === "/journeys") sheet.value = "journeys";
  else if (cmd === "/staff") sheet.value = "staff";
  else {
    draft.value = "/request ";
    void nextTick(() => input.value?.focus());
  }
}
/** Arrow keys, Enter and Escape on the slash suggestions (the composer is a combobox while they show). */
function onInputKey(e: KeyboardEvent) {
  if (!showSuggestions.value) return;
  const n = suggestions.value.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active.value = (active.value + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
  } else if (e.key === "Enter") {
    e.preventDefault();
    runSlash(suggestions.value[active.value]!.cmd);
  } else if (e.key === "Escape") {
    e.preventDefault();
    dismissed.value = true;
  }
}

// The + menu: focus goes into it, arrows move, Escape (or Tab away) closes it and focus returns to +.
async function toggleMenu() {
  if (menu.value) return closeMenu(true);
  menu.value = true;
  await nextTick();
  menuItems()[0]?.focus();
}
const menuItems = () => Array.from(menuEl.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
function closeMenu(refocus: boolean) {
  if (!menu.value) return;
  menu.value = false;
  if (refocus) void nextTick(() => plusButton.value?.focus());
}
function onMenuKey(e: KeyboardEvent) {
  const items = menuItems();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (i: number) => {
    e.preventDefault();
    items[(i + items.length) % items.length]?.focus();
  };
  if (e.key === "ArrowDown") go(at + 1);
  else if (e.key === "ArrowUp") go(at - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(items.length - 1);
  else if (e.key === "Escape") {
    e.preventDefault();
    closeMenu(true);
  } else if (e.key === "Tab") closeMenu(false);
}
/** Clicking or tapping anywhere else closes the menu. */
function onMenuBlur(e: FocusEvent) {
  const to = e.relatedTarget as Node | null;
  if (to && (menuEl.value?.contains(to) || plusButton.value?.contains(to))) return;
  closeMenu(false);
}

function closeSheet() {
  sheet.value = null;
  void nextTick(() => input.value?.focus({ preventScroll: true }));
}
function onPick(p: ContextPick) {
  sheet.value = null;
  if (p.kind === "journey") emit("journey", p.id, p.title);
  else emit("request", p.ref, true);
}
function attach() {
  closeMenu(false);
  fileInput.value?.click();
}
function onFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  // A copy: clearing the input below empties the FileList.
  if (files?.length) emit("attach", Array.from(files));
  if (fileInput.value) fileInput.value.value = "";
}

function submit() {
  const q = draft.value.trim();
  if (!q) return;
  const ref = referenceIn(q);
  if (ref) {
    draft.value = "";
    return void emit("request", ref);
  }
  const slash = SLASH.value.find((s) => s.cmd === q.toLowerCase());
  if (slash) return runSlash(slash.cmd);
  if (suggestions.value.length === 1) return runSlash(suggestions.value[0]!.cmd);
  if (!props.canAsk && !formInput.value) return;
  draft.value = "";
  emit("ask", q);
}
</script>

<template>
  <!-- A reading width, however wide the kiosk: the conversation and its composer stay centred. -->
  <div :class="cn('relative mx-auto flex w-full max-w-4xl flex-col', heightClass ?? 'min-h-[min(62dvh,560px)]')">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
      <RouterLink :to="{ path: '/kiosk', query: { prefs: answers === 'local' ? 'knowledge' : 'model' } }" class="chip hover:text-ink">
        <Settings2 class="size-3.5" aria-hidden="true" />
        <template v-if="answers === 'local'">Kiosk only · no AI model</template>
        <template v-else>{{ catalogError ? "Agent offline" : modelLabel ? `${provider?.label} · ${modelLabel}` : "Loading model…" }}{{ answers === "auto" ? " · curated answers on this device" : "" }}</template>
      </RouterLink>
      <div class="flex items-center gap-1">
        <button v-if="turns.length" type="button" class="inline-flex h-9 items-center gap-1 rounded-full px-2 hover:bg-mist hover:text-ink" @click="emit('reset')"><RotateCcw class="size-3.5" aria-hidden="true" /> New</button>
        <button type="button" class="inline-flex h-9 items-center gap-1 rounded-full px-2 hover:bg-mist hover:text-ink" :aria-expanded="drawer" aria-controls="threads-drawer" @click="drawer = !drawer">
          <MessagesSquare class="size-3.5" aria-hidden="true" /> Conversations<span v-if="threads.length" class="rounded-full bg-mist px-1.5 text-[11px] text-ink">{{ threads.length }}</span>
        </button>
        <slot name="actions" />
      </div>
    </div>

    <p v-if="noProvider" role="alert" class="caution mb-3 px-3 py-2 text-sm">
      No AI provider is configured. Add a provider key as a Worker secret (locally: <code>apps/web/.dev.vars</code>).
    </p>


    <div ref="scroller" :class="cn('-mx-1 mt-2 flex-1 space-y-5 px-1', heightClass ? 'min-h-0 overflow-y-auto pb-36 [scrollbar-width:thin]' : 'pb-4')" aria-live="polite">
      <div v-if="!turns.length" class="pt-16 text-center">
        <p class="text-lg font-medium tracking-tight text-ink">Ask a question, or tap the microphone.</p>
        <p class="mt-1 text-sm text-gray-500">Answers come from trusted sources, with references.</p>
      </div>
      <template v-for="t in turns" :key="t.id">
        <!-- A journey or a request loaded into the conversation, kept with it. -->
        <div v-if="t.role === 'assistant' && (t.journey || t.request)" class="min-w-0">
          <ChatJourney
            v-if="t.journey"
            :turn="t.journey"
            :services="services"
            :notebook="notebook"
            @update="(patch) => emit('journeyUpdate', t.id, patch)"
            @done="(id) => emit('journeyDone', id)"
            @speak="(x) => emit('speak', x)"
          />
          <RequestCard v-else-if="t.request" :reference="t.request.ref" :services="services" :notebook="notebook" :open="t.request.open" />
        </div>
        <div v-else-if="t.role === 'user'" class="flex justify-end">
          <p v-if="t.via" class="flex max-w-[85%] items-center gap-2 rounded-3xl rounded-br-lg bg-brand-dark px-4 py-2.5 text-on-brand">
            <component :is="VIA[t.via].icon" class="size-4 shrink-0 opacity-80" aria-hidden="true" />
            <span class="sr-only">{{ VIA[t.via].said }}</span>
            <span :class="cn('min-w-0 break-words', t.via === 'request' && 'font-mono tracking-wider')">{{ t.text }}</span>
          </p>
          <p v-else class="max-w-[85%] rounded-3xl rounded-br-lg bg-brand-dark px-4 py-2.5 whitespace-pre-wrap text-on-brand">{{ t.text }}</p>
        </div>
        <div v-else class="flex gap-3">
          <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-mist text-ink ring-1 ring-gray-200">
            <Paperclip v-if="t.via === 'file'" class="size-3.5" aria-hidden="true" />
            <HardDrive v-else-if="t.local" class="size-3.5" aria-label="Answered on this device from the knowledge base" />
            <Bot v-else class="size-3.5" aria-hidden="true" />
          </span>
          <div class="min-w-0 flex-1 space-y-2">
            <ul v-if="t.todos.length" class="space-y-1 rounded-lg bg-mist px-3 py-2 text-sm" aria-label="Agent plan">
              <li v-for="(todo, i) in t.todos" :key="i" class="flex items-center gap-2">
                <CheckCircle2 v-if="todo.status === 'completed'" class="size-4 text-success" aria-label="done" />
                <CircleDot v-else-if="todo.status === 'in_progress'" class="size-4 text-info" aria-label="in progress" />
                <Circle v-else class="size-4 text-gray-400" aria-label="pending" />
                <span :class="cn(todo.status === 'completed' && 'text-gray-400 line-through')">{{ todo.content }}</span>
              </li>
            </ul>
            <div v-if="t.tools.length" class="flex flex-wrap gap-1.5">
              <span
                v-for="tool in t.tools.filter((x) => x.name !== 'write_todos')"
                :key="tool.id"
                :class="cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs', tool.nested ? 'bg-info/10 text-info' : 'bg-brand/10 text-brand-dark')"
              >
                <Wrench v-if="tool.done" class="size-3" aria-hidden="true" />
                <Loader2 v-else class="size-3 animate-spin" aria-hidden="true" />
                {{ toolLabel(tool) }}
              </span>
            </div>
            <CommandCard
              v-if="t.card"
              :card="t.card"
              :can-ask-assistant="hasAssistant"
              @yes="emit('card', t.id, 'yes')"
              @no="emit('card', t.id, 'no')"
              @start="emit('card', t.id, 'start')"
              @sign-in="emit('card', t.id, 'sign-in')"
              @ask-assistant="emit('card', t.id, 'ask-assistant')"
            />
            <AnswerText v-if="t.text" :text="t.text" />
            <div v-if="t.text && !t.card && !t.via && !t.pending && !t.error && !(t.local && !t.tools.length)" class="text-xs text-gray-500">
              <p v-if="t.review === 'sent'" role="status" class="inline-flex items-center gap-1"><ShieldCheck class="size-3.5 text-success" aria-hidden="true" /> Sent to the moderators to check. Thank you.</p>
              <button
                v-else
                type="button"
                class="inline-flex items-center gap-1 hover:text-ink disabled:opacity-50"
                :disabled="t.review === 'sending'"
                title="Sends this question and answer, and your notebook's name, to the moderators. Nothing else."
                @click="emit('review', t.id)"
              >
                <ShieldCheck class="size-3.5" aria-hidden="true" />
                {{ t.review === "failed" ? "Couldn't send. Try again" : "Ask a moderator to check this answer" }}
              </button>
            </div>
            <p v-if="t.pending && !t.text && !t.tools.length" class="flex items-center gap-2 text-sm text-gray-400"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Thinking…</p>
            <p v-if="t.error" role="alert" class="rounded-md bg-danger/10 px-3 py-2 text-sm text-red-800">{{ t.error }}</p>
          </div>
        </div>
      </template>
      <div ref="end" class="scroll-mb-36" />
    </div>

    <!-- The notebook's conversations slide in from the right (LIB-53). -->
    <Transition enter-from-class="translate-x-full" leave-to-class="translate-x-full" enter-active-class="transition duration-200 ease-out" leave-active-class="transition duration-150 ease-in">
      <div v-if="drawer" id="threads-drawer" :class="cn('z-30', heightClass ? 'absolute inset-y-0 right-0 w-[min(22rem,100%)]' : 'fixed inset-y-0 right-0 w-[min(22rem,100vw)]')">
        <ThreadDrawer
          :threads="threads"
          :active-id="activeThreadId"
          :notebook-title="notebookTitle"
          @open="(id) => ((drawer = false), emit('openThread', id))"
          @new="(drawer = false), emit('reset')"
          @close="drawer = false"
        />
      </div>
    </Transition>
    <div v-if="drawer" :class="cn('z-20 bg-black/20', heightClass ? 'absolute inset-0' : 'fixed inset-0')" aria-hidden="true" @click="drawer = false" />

    <!-- The context loader slides up over the conversation. -->
    <Transition enter-from-class="translate-y-full opacity-0" leave-to-class="translate-y-full opacity-0" enter-active-class="transition duration-200 ease-out" leave-active-class="transition duration-150 ease-in">
      <div v-if="sheet" :class="cn('z-20 flex flex-col justify-end', heightClass ? 'absolute inset-x-0 top-10 bottom-0' : 'fixed inset-x-0 bottom-0 mx-auto max-h-[75dvh] w-full max-w-4xl px-2')">
        <ContextSheet :key="sheet" :mode="sheet" class="max-h-full" @pick="onPick" @close="closeSheet" />
      </div>
    </Transition>

    <!-- The composer floats over the bottom of the conversation, as in chat apps: inside the pane when
         it has a fixed height (full layout), otherwise pinned to the bottom of the screen while the
         conversation is in view. -->
    <div
      :class="
        cn(
          'pointer-events-none z-10 bg-linear-to-t from-surface from-55% to-transparent px-0.5 pt-12',
          heightClass ? 'absolute inset-x-0 bottom-0 pb-0.5' : 'sticky bottom-0 -mx-0.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        )
      "
    >
      <!-- The + menu (a menu: focus moves into it), and the slash suggestions (a listbox the composer
           controls: focus stays in the composer, arrows move the highlight). -->
      <div v-if="menu" id="kiosk-plus-menu" ref="menuEl" role="menu" aria-label="Add to the conversation" class="pointer-events-auto mb-2 space-y-0.5 rounded-2xl border border-gray-200 bg-surface p-1.5 shadow-[var(--shadow-lift)]" @keydown="onMenuKey" @focusout="onMenuBlur">
        <button type="button" role="menuitem" tabindex="-1" :class="MENU_ITEM" @click="attach">
          <Paperclip class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
          <span class="min-w-0 flex-1">Attach a file to the notebook</span>
        </button>
        <button v-for="s in SLASH" :key="s.cmd" type="button" role="menuitem" tabindex="-1" :class="MENU_ITEM" @click="runSlash(s.cmd)">
          <component :is="s.icon" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
          <span class="min-w-0 flex-1">{{ s.label }}</span>
          <span class="font-mono text-xs text-gray-500" aria-hidden="true">{{ s.cmd }}</span>
        </button>
      </div>
      <ul v-else-if="showSuggestions" id="kiosk-slash" role="listbox" aria-label="Commands" class="pointer-events-auto mb-2 space-y-0.5 rounded-2xl border border-gray-200 bg-surface p-1.5 shadow-[var(--shadow-lift)]">
        <li
          v-for="(s, i) in suggestions"
          :id="`kiosk-slash-${i}`"
          :key="s.cmd"
          role="option"
          :aria-selected="i === active"
          :class="cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-ink', i === active ? 'bg-mist' : 'hover:bg-mist')"
          @mousedown.prevent
          @mousemove="active = i"
          @click="runSlash(s.cmd)"
        >
          <component :is="s.icon" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
          <span class="font-mono text-ink">{{ s.cmd }}</span>
          <span class="min-w-0 flex-1 truncate text-gray-600">{{ s.label }}</span>
        </li>
      </ul>
      <!-- A form is open in the conversation: the message box fills it, or asks a question instead. -->
      <div v-if="openForm" class="pointer-events-auto mb-2 flex flex-wrap items-center justify-center gap-2 text-xs">
        <span class="rounded-full bg-brand/10 px-3 py-1 text-ink">{{ formInput ? `Your words fill “${openForm.label}”` : "Asking a question" }}</span>
        <button type="button" class="rounded-full px-3 py-1 text-gray-600 ring-1 ring-gray-200 hover:bg-mist hover:text-ink" @click="askInstead = !askInstead">
          {{ formInput ? "Ask a question instead" : `Back to “${openForm.label}”` }}
        </button>
      </div>
      <input ref="fileInput" type="file" multiple :accept="ACCEPTED_FILES" class="sr-only" tabindex="-1" aria-hidden="true" @change="onFiles" />
      <form
        class="pointer-events-auto flex items-center gap-1.5 rounded-[1.75rem] border border-gray-200 bg-surface/95 py-1.5 pr-1.5 pl-1.5 shadow-[var(--shadow-lift)] backdrop-blur-xl transition focus-within:border-gray-400 focus-within:ring-4 focus-within:ring-brand/15"
        @submit.prevent="submit"
      >
        <button
          ref="plusButton"
          type="button"
          :class="cn('grid size-10 shrink-0 place-items-center rounded-full transition', menu ? 'bg-mist text-ink' : 'text-gray-500 hover:bg-mist hover:text-ink')"
          aria-haspopup="menu"
          :aria-expanded="menu"
          :aria-controls="menu ? 'kiosk-plus-menu' : undefined"
          aria-label="Add a file, a journey or a request"
          title="Add a file, a journey or a request"
          @click="toggleMenu"
          @keydown.down.prevent="!menu && toggleMenu()"
        >
          <Plus :class="cn('size-5 transition-transform', menu && 'rotate-45')" aria-hidden="true" />
        </button>
        <label for="kiosk-question" class="sr-only">Your question</label>
        <input
          id="kiosk-question"
          ref="input"
          v-model="draft"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="showSuggestions"
          aria-controls="kiosk-slash"
          :aria-activedescendant="showSuggestions ? `kiosk-slash-${active}` : undefined"
          class="min-w-0 flex-1 bg-transparent py-2.5 text-ink outline-none placeholder:text-gray-400"
          :placeholder="listening ? 'Listening…' : formInput ? `Answer “${formInput.label}” in your own words` : 'Ask anything, or type /'"
          :maxlength="MAX_MESSAGE_CHARS"
          autocomplete="off"
          @keydown="onInputKey"
        />
        <button
          v-if="voiceSupported"
          type="button"
          :class="cn('grid size-10 shrink-0 place-items-center rounded-full transition', listening ? 'bg-brand text-console ring-4 ring-brand/25' : 'text-gray-500 hover:bg-mist hover:text-ink')"
          :aria-pressed="listening"
          :aria-label="listening ? 'Stop listening' : 'Ask by voice'"
          @click="emit('mic')"
        >
          <MicOff v-if="listening" class="size-4" aria-hidden="true" />
          <Mic v-else class="size-4" aria-hidden="true" />
        </button>
        <button type="submit" class="btn-primary size-10 shrink-0 p-0" :disabled="!draft.trim() || (!canAsk && !formInput && !draft.trim().startsWith('/') && !referenceIn(draft))" aria-label="Ask">
          <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" />
          <ArrowUp v-else class="size-4" aria-hidden="true" />
        </button>
      </form>
      <p class="mt-1.5 truncate text-center text-[11px] text-gray-400">Facts from cited sources. Check important things with a person.</p>
    </div>
  </div>
</template>
