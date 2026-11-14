<script setup lang="ts">
// The notebook's conversations, as a drawer from the right of Ask Me (LIB-53): switch to another one,
// start a new one, or find one by its title, without leaving the conversation. My notebook keeps
// the same list with the rest of the notebook.
import { MessageSquarePlus, MessagesSquare, Search, X } from "@lucide/vue";
import { computed, nextTick, onMounted, ref } from "vue";
import type { ThreadRecord } from "@/lib/browser/store";
import { cn } from "@/lib/cn";

const props = defineProps<{ threads: ThreadRecord[]; activeId: string; notebookTitle: string | null }>();
const emit = defineEmits<{ open: [id: string]; new: []; close: [] }>();

const query = ref("");
const panel = ref<HTMLElement | null>(null);
onMounted(async () => {
  await nextTick();
  panel.value?.querySelector<HTMLElement>("input, button")?.focus();
});
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return [...props.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((t) => !q || t.title.toLowerCase().includes(q));
});
/** "Today 10:18", "Yesterday", "12 Nov". */
function when(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
/** What the conversation holds: a journey, a request, or questions. */
const kind = (t: ThreadRecord) => (t.turns.some((x) => x.journey) ? "Journey" : t.turns.some((x) => x.request) ? "Request" : null);
</script>

<template>
  <aside ref="panel" class="flex h-full w-full flex-col border-l border-gray-200 bg-surface shadow-[var(--shadow-lift)]" role="dialog" aria-labelledby="threads-title" @keydown.esc="emit('close')">
    <div class="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
      <MessagesSquare class="size-4 text-brand" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <h3 id="threads-title" class="text-sm font-semibold text-ink">Conversations</h3>
        <p v-if="notebookTitle" class="truncate text-xs text-gray-500">In {{ notebookTitle }}</p>
      </div>
      <button type="button" class="grid size-10 place-items-center rounded-full text-gray-500 hover:bg-mist hover:text-ink" aria-label="Close conversations" @click="emit('close')"><X class="size-4" aria-hidden="true" /></button>
    </div>
    <div class="space-y-2 px-4 pt-3">
      <button type="button" class="btn-light h-10 w-full justify-center" @click="emit('new')"><MessageSquarePlus class="size-4" aria-hidden="true" /> New conversation</button>
      <div v-if="threads.length > 5" class="flex items-center gap-2 rounded-full bg-mist px-3">
        <Search class="size-4 text-gray-500" aria-hidden="true" />
        <label for="threads-search" class="sr-only">Find a conversation</label>
        <input id="threads-search" v-model="query" class="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink outline-none" placeholder="Find a conversation" />
      </div>
    </div>
    <ul class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-3 [scrollbar-width:thin]">
      <li v-for="t in shown" :key="t.id">
        <button
          type="button"
          :class="cn('flex min-h-12 w-full flex-col items-start rounded-xl px-3 py-2 text-left', t.id === activeId ? 'bg-brand/10' : 'hover:bg-mist')"
          :aria-current="t.id === activeId ? 'true' : undefined"
          @click="emit('open', t.id)"
        >
          <span class="line-clamp-1 w-full text-sm font-medium text-ink">{{ t.title }}</span>
          <span class="text-xs text-gray-500">{{ when(t.updatedAt) }}<template v-if="kind(t)"> · {{ kind(t) }}</template></span>
        </button>
      </li>
      <li v-if="!shown.length" class="px-3 py-2 text-sm text-gray-500">{{ query ? "Nothing matches." : "No conversations yet. Ask something, or type / for a journey." }}</li>
    </ul>
  </aside>
</template>
