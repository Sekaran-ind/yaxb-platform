<script setup lang="ts">
// The visitor's profile (sign in, or their initials once signed in), which opens inside the kiosk.
// It sits in Ask Me's header beside Conversations and Preferences (tone "light"), or on the dark
// player (tone "dark").
import { UserRound } from "@lucide/vue";
import { cn } from "@/lib/cn";

const props = withDefaults(defineProps<{ nickname: string | null; open: boolean; tone?: "dark" | "light" }>(), { tone: "dark" });
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
    :class="
      cn(
        'grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 transition',
        props.tone === 'light'
          ? props.nickname
            ? 'bg-brand-dark text-on-brand ring-brand-dark/30 hover:brightness-110'
            : 'bg-surface text-gray-600 ring-gray-200 hover:bg-mist hover:text-ink'
          : props.open
            ? 'bg-white text-console ring-white'
            : props.nickname
              ? 'bg-brand text-console ring-brand/40 hover:brightness-110'
              : 'bg-white/5 text-white/80 ring-white/15 hover:bg-white/10 hover:text-white',
      )
    "
    :aria-pressed="props.open"
    :aria-label="props.open ? 'Close your profile' : props.nickname ? `Your profile (${props.nickname})` : 'Sign in'"
    :title="props.nickname ? `${props.nickname}: your profile` : 'Sign in'"
    @click="emit('toggle')"
  >
    <template v-if="props.nickname">{{ initials(props.nickname) }}</template>
    <UserRound v-else class="size-4" aria-hidden="true" />
  </button>
</template>
