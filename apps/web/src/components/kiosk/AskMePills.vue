<script setup lang="ts">
// The kiosk's own controls, as pills at the end of the tab row (beside Ask Me, Quick tools…): on Ask
// Me, a new conversation and the conversations drawer; always, the visitor's profile and the
// preferences. At the front desk: End session, and the staff lock.
import { Lock, LogOut, MessagesSquare, RotateCcw, ShieldCheck, SlidersHorizontal, UserRound } from "@lucide/vue";
import { cn } from "@/lib/cn";

defineProps<{ restricted: boolean; /** Only New and Conversations, inside another surface's pills (the catalogue's Ask Me). */ conversationOnly?: boolean; onAskMe: boolean; canNew: boolean; threads: number; drawerOpen: boolean; nickname: string | null; /** The child safety lock is on (CHL-8): a pill says so. */ child?: boolean }>();
const emit = defineEmits<{ new: []; conversations: []; profile: []; prefs: []; endSession: []; unlock: []; child: [] }>();
const pill = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-gray-600 transition hover:bg-surface hover:text-ink";
/**
 * The words go when the screens area is under 64rem, as the catalogue's do (the title stays as the
 * hint): with New, a count and the child lock, worded pills don't fit beside the tabs in Full.
 */
const words = "@max-[64rem]/screens:sr-only";
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
</script>

<template>
  <div :class="conversationOnly ? 'contents' : 'yj-trail rounded-full bg-mist p-1'" :role="conversationOnly ? undefined : 'group'" :aria-label="conversationOnly ? undefined : 'Kiosk controls'">
    <template v-if="restricted">
      <button type="button" :class="pill" @click="emit('endSession')"><LogOut class="size-4" aria-hidden="true" /> End session</button>
      <button type="button" :class="cn(pill, 'px-2.5')" aria-label="Staff: leave the front desk" title="Staff" @click="emit('unlock')"><Lock class="size-4" aria-hidden="true" /></button>
    </template>
    <template v-else>
      <template v-if="onAskMe">
        <button v-if="canNew" type="button" :class="pill" title="New conversation" @click="emit('new')"><RotateCcw class="size-4" aria-hidden="true" /><span :class="words">New</span></button>
        <button type="button" :class="cn(pill, drawerOpen && 'bg-surface text-ink shadow-sm')" :aria-expanded="drawerOpen" aria-controls="threads-drawer" title="Conversations" @click="emit('conversations')">
          <MessagesSquare class="size-4" aria-hidden="true" /><span :class="words">Conversations</span><span v-if="threads" class="rounded-full bg-surface px-1.5 text-[11px] text-ink">{{ threads }}</span>
        </button>
      </template>
      <template v-if="!conversationOnly">
      <button type="button" :class="cn(pill, 'px-2', nickname && 'text-ink')" :aria-label="nickname ? `Your profile (${nickname})` : 'Sign in'" :title="nickname ? `${nickname}: your profile` : 'Sign in'" @click="emit('profile')">
        <span v-if="nickname" class="grid size-6 place-items-center rounded-full bg-brand-dark text-[10px] font-semibold text-on-brand">{{ initials(nickname) }}</span>
        <UserRound v-else class="size-4" aria-hidden="true" />
      </button>
      <button v-if="child" type="button" :class="cn(pill, 'text-ink')" aria-label="Child safety lock is on" title="Child safety lock is on" @click="emit('child')"><ShieldCheck class="size-4 text-brand" aria-hidden="true" /><span :class="words">Child lock</span></button>
      <button type="button" :class="cn(pill, 'px-2.5')" aria-label="Preferences" title="Preferences" @click="emit('prefs')"><SlidersHorizontal class="size-4" aria-hidden="true" /></button>
      </template>
    </template>
  </div>
</template>
