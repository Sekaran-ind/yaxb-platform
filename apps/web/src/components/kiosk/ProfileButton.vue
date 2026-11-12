<script setup lang="ts">
// The player's one control: the visitor's profile and preferences (sign in, language, layout,
// theme, voice and the rest), which open inside the kiosk.
import { UserRound } from "@lucide/vue";
import { cn } from "@/lib/cn";

const props = defineProps<{ nickname: string | null; open: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
</script>

<template>
  <button
    type="button"
    :class="cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 transition', props.open ? 'bg-white text-console ring-white' : props.nickname ? 'bg-brand text-console ring-brand/40 hover:brightness-110' : 'bg-white/5 text-white/80 ring-white/15 hover:bg-white/10 hover:text-white')"
    :aria-pressed="props.open"
    :aria-label="props.open ? 'Close preferences' : props.nickname ? `Profile and preferences (${props.nickname})` : 'Sign in and preferences'"
    :title="props.nickname ? `${props.nickname}: profile and preferences` : 'Sign in and preferences'"
    @click="emit('toggle')"
  >
    <template v-if="props.nickname">{{ initials(props.nickname) }}</template>
    <UserRound v-else class="size-4" aria-hidden="true" />
  </button>
</template>
