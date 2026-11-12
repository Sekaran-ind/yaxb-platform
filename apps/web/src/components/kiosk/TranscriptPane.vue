<script setup lang="ts">
// The Transcript screen: ask box and the conversation with live agent activity.
import { MAX_MESSAGE_CHARS } from "@sekaran-ind/yaxb-core/schemas";
import { Bot, CheckCircle2, HardDrive, Circle, CircleDot, Loader2, NotebookPen, RotateCcw, Send, Settings2, ShieldCheck, Wrench } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { cn } from "@/lib/cn";
import AnswerText from "./AnswerText.vue";
import CommandCard from "./CommandCard.vue";
import type { ChatTurn, ProvidersResponse, ToolActivity } from "@/lib/types";

const props = defineProps<{
  turns: ChatTurn[];
  busy: boolean;
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
const emit = defineEmits<{ ask: [question: string]; reset: []; card: [turnId: string, action: "yes" | "no" | "start" | "sign-in" | "ask-assistant"]; review: [turnId: string] }>();

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
const provider = computed(() => props.catalog?.providers.find((p) => p.id === props.selection?.provider));
const modelLabel = computed(() => provider.value?.models.find((m) => m.id === props.selection?.model)?.label);
const noProvider = computed(() => props.answers !== "local" && props.catalog && !props.catalog.providers.some((p) => p.configured));

watch(
  () => props.turns.map((t) => t.text.length + t.tools.length).join(),
  async () => {
    await nextTick();
    end.value?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  <div class="flex min-h-[360px] flex-col">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
      <RouterLink to="/settings" class="inline-flex items-center gap-1 rounded-full bg-mist px-3 py-1 hover:text-ink">
        <Settings2 class="size-3.5" aria-hidden="true" />
        <template v-if="answers === 'local'">Knowledge base only · on this device</template>
        <template v-else>{{ catalogError ? "Agent offline" : modelLabel ? `${provider?.label} · ${modelLabel}` : "Loading model…" }}{{ answers === "auto" ? " · curated answers on this device" : "" }}</template>
      </RouterLink>
      <span v-if="notebookTitle" class="inline-flex items-center gap-1 truncate rounded-full bg-mist px-3 py-1" title="Answers can use this notebook's sources and memory">
        <NotebookPen class="size-3.5" aria-hidden="true" /> {{ notebookTitle }} · {{ sourceCount }} source{{ sourceCount === 1 ? "" : "s" }}
      </span>
      <button v-if="turns.length" type="button" class="inline-flex items-center gap-1 hover:text-ink" @click="emit('reset')"><RotateCcw class="size-3.5" aria-hidden="true" /> New conversation</button>
    </div>

    <p v-if="noProvider" role="alert" class="mb-3 rounded-md bg-warning/30 px-3 py-2 text-sm text-ink">
      No AI provider is configured. Add a provider key as a Worker secret (locally: <code>apps/web/.dev.vars</code>).
    </p>

    <form class="flex gap-2" @submit.prevent="submit">
      <label for="kiosk-question" class="sr-only">Your question</label>
      <input id="kiosk-question" v-model="draft" class="input" placeholder="How may I help you ?" :maxlength="MAX_MESSAGE_CHARS" autocomplete="off" />
      <button type="submit" class="btn-primary" :disabled="!canAsk || !draft.trim()">
        <Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" />
        <Send v-else class="size-4" aria-hidden="true" />
        Ask
      </button>
    </form>

    <div class="mt-4 flex-1 space-y-4" aria-live="polite">
      <p v-if="!turns.length" class="pt-16 text-center text-gray-400">Let us explore. Ask a question or tap the microphone.</p>
      <template v-for="t in turns" :key="t.id">
        <div v-if="t.role === 'user'" class="flex justify-end">
          <p class="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-dark px-4 py-2 whitespace-pre-wrap text-on-brand">{{ t.text }}</p>
        </div>
        <div v-else class="flex gap-3">
          <HardDrive v-if="t.local" class="mt-1 size-6 shrink-0 text-brand" aria-label="Answered on this device from the knowledge base" />
          <Bot v-else class="mt-1 size-6 shrink-0 text-brand" aria-hidden="true" />
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
      <div ref="end" />
    </div>
  </div>
</template>
