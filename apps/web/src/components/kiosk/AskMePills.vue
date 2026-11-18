<script setup lang="ts">
// Ask Me's own control at the end of the tab row: a new conversation. The person's controls (the
// profile, conversations, contacts, the child lock, the preferences; End session and the staff lock
// at the front desk) are buttons in the player (PlayerButtons, PLY-2).
// Inside the catalogue's Ask Me (`conversationOnly`), whose player is the catalogue's, Conversations
// joins New among the catalogue's pills.
import { MessagesSquare, RotateCcw } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";

const props = defineProps<{ conversationOnly?: boolean; onAskMe: boolean; canNew: boolean; threads: number; drawerOpen: boolean }>();
const emit = defineEmits<{ new: []; conversations: [] }>();
const pill = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-gray-600 transition hover:bg-surface hover:text-ink";
/** The words go when the screens area is under 64rem (the title stays as the hint). */
const words = "@max-[64rem]/screens:sr-only";
const any = computed(() => props.onAskMe && (props.canNew || props.conversationOnly));
</script>

<template>
  <div v-if="any" :class="conversationOnly ? 'contents' : 'yj-trail rounded-full bg-mist p-1'" :role="conversationOnly ? undefined : 'group'" :aria-label="conversationOnly ? undefined : 'Conversation'">
    <button v-if="canNew" type="button" :class="pill" title="New conversation" @click="emit('new')"><RotateCcw class="size-4" aria-hidden="true" /><span :class="words">New</span></button>
    <button v-if="conversationOnly" type="button" :class="cn(pill, drawerOpen && 'bg-surface text-ink shadow-sm')" :aria-expanded="drawerOpen" aria-controls="threads-drawer" title="Conversations" @click="emit('conversations')">
      <MessagesSquare class="size-4" aria-hidden="true" /><span :class="words">Conversations</span><span v-if="threads" class="rounded-full bg-surface px-1.5 text-[11px] text-ink">{{ threads }}</span>
    </button>
  </div>
</template>
