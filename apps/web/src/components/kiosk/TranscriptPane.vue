<script setup lang="ts">
// The Transcript screen: ask box and the conversation with live agent activity.
import { MAX_MESSAGE_CHARS } from "@sekaran-ind/yaxb-core/schemas";
import { ArrowUp, Bot, CheckCircle2, HardDrive, Circle, CircleDot, Loader2, Mic, MicOff, NotebookPen, RotateCcw, Settings2, ShieldCheck, Wrench } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { cn } from "@/lib/cn";
import AnswerText from "./AnswerText.vue";
import CommandCard from "./CommandCard.vue";
import type { ChatTurn, ProvidersResponse, ToolActivity } from "@/lib/types";

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
}>();
/** card: a command card's button (yes, no, start, sign-in, ask-assistant) for the shell to carry out. */
const emit = defineEmits<{ mic: []; ask: [question: string]; reset: []; card: [turnId: string, action: "yes" | "no" | "start" | "sign-in" | "ask-assistant"]; review: [turnId: string] }>();

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

function submit() {
  const q = draft.value.trim();
  if (!q || !props.canAsk) return;
  draft.value = "";
  emit("ask", q);
}
</script>

<template>
  <div :class="cn('relative flex flex-col', heightClass ?? 'min-h-[min(62dvh,560px)]')">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
      <RouterLink to="/settings" class="chip hover:text-ink">
        <Settings2 class="size-3.5" aria-hidden="true" />
        <template v-if="answers === 'local'">Knowledge base only · on this device</template>
        <template v-else>{{ catalogError ? "Agent offline" : modelLabel ? `${provider?.label} · ${modelLabel}` : "Loading model…" }}{{ answers === "auto" ? " · curated answers on this device" : "" }}</template>
      </RouterLink>
      <span v-if="notebookTitle" class="chip truncate" title="Answers can use this notebook's sources and memory">
        <NotebookPen class="size-3.5" aria-hidden="true" /> {{ notebookTitle }} · {{ sourceCount }} source{{ sourceCount === 1 ? "" : "s" }}
      </span>
      <button v-if="turns.length" type="button" class="inline-flex items-center gap-1 hover:text-ink" @click="emit('reset')"><RotateCcw class="size-3.5" aria-hidden="true" /> New conversation</button>
    </div>

    <p v-if="noProvider" role="alert" class="mb-3 rounded-md bg-warning/30 px-3 py-2 text-sm text-ink">
      No AI provider is configured. Add a provider key as a Worker secret (locally: <code>apps/web/.dev.vars</code>).
    </p>


    <div ref="scroller" :class="cn('-mx-1 mt-2 flex-1 space-y-5 px-1', heightClass ? 'min-h-0 overflow-y-auto pb-36 [scrollbar-width:thin]' : 'pb-4')" aria-live="polite">
      <div v-if="!turns.length" class="pt-16 text-center">
        <p class="text-lg font-medium tracking-tight text-ink">Ask a question, or tap the microphone.</p>
        <p class="mt-1 text-sm text-gray-500">Answers come from trusted sources, with references.</p>
      </div>
      <template v-for="t in turns" :key="t.id">
        <div v-if="t.role === 'user'" class="flex justify-end">
          <p class="max-w-[85%] rounded-3xl rounded-br-lg bg-brand-dark px-4 py-2.5 whitespace-pre-wrap text-on-brand">{{ t.text }}</p>
        </div>
        <div v-else class="flex gap-3">
          <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-mist text-ink ring-1 ring-gray-200">
            <HardDrive v-if="t.local" class="size-3.5" aria-label="Answered on this device from the knowledge base" />
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
            <div v-if="t.text && !t.card && !t.pending && !t.error" class="text-xs text-gray-500">
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
      <form
        class="pointer-events-auto flex items-center gap-1.5 rounded-[1.75rem] border border-gray-200 bg-surface/95 py-1.5 pr-1.5 pl-5 shadow-[var(--shadow-lift)] backdrop-blur-xl transition focus-within:border-gray-400 focus-within:ring-4 focus-within:ring-brand/15"
        @submit.prevent="submit"
      >
        <label for="kiosk-question" class="sr-only">Your question</label>
        <input id="kiosk-question" v-model="draft" class="min-w-0 flex-1 bg-transparent py-2.5 text-ink outline-none placeholder:text-gray-400" :placeholder="listening ? 'Listening…' : 'Ask anything…'" :maxlength="MAX_MESSAGE_CHARS" autocomplete="off" />
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
        <button type="submit" class="btn-primary size-10 shrink-0 p-0" :disabled="!canAsk || !draft.trim()" aria-label="Ask">
          <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" />
          <ArrowUp v-else class="size-4" aria-hidden="true" />
        </button>
      </form>
      <p class="mt-1.5 truncate text-center text-[11px] text-gray-400">Facts from cited sources. Check important things with a person.</p>
    </div>
  </div>
</template>
