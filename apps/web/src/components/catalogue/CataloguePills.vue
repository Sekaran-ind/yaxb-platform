<script setup lang="ts">
// The Service Catalogue's controls, as pills at the end of its tab row (as the kiosk's are): New
// service, Open the kiosk, the staff sign-in (or your initials, to sign out), and Preferences, which
// open inside the catalogue.
import { LogIn, MonitorSmartphone, Plus, SlidersHorizontal } from "@lucide/vue";
import { cn } from "@/lib/cn";

defineProps<{ who: { name: string; guest: boolean; roles: string } | null; signingIn: boolean }>();
const emit = defineEmits<{ newService: []; signIn: []; signOut: []; prefs: [] }>();
const pill = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-gray-600 transition hover:bg-surface hover:text-ink";
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
</script>

<template>
  <div class="yj-trail rounded-full bg-mist p-1" role="group" aria-label="Catalogue controls">
    <button type="button" :class="cn(pill, 'bg-brand-dark text-on-brand hover:bg-brand-dark hover:text-on-brand hover:brightness-110')" @click="emit('newService')">
      <Plus class="size-4" aria-hidden="true" /><span class="max-sm:sr-only">New service</span>
    </button>
    <RouterLink to="/kiosk" :class="pill" title="Open the kiosk"><MonitorSmartphone class="size-4" aria-hidden="true" /><span class="max-sm:sr-only">Open the kiosk</span></RouterLink>
    <button
      v-if="!who || who.guest"
      type="button"
      :class="cn(pill, 'px-2.5', signingIn && 'bg-surface text-ink shadow-sm')"
      :aria-pressed="signingIn"
      aria-label="Staff sign in"
      title="Staff sign in: see every service, review and manage roles"
      @click="emit('signIn')"
    >
      <LogIn class="size-4" aria-hidden="true" />
    </button>
    <button v-else type="button" :class="cn(pill, 'px-2')" :aria-label="`Signed in as ${who.name}. Sign out`" :title="`${who.name} (${who.roles || 'no roles'}): sign out`" @click="emit('signOut')">
      <span class="grid size-6 place-items-center rounded-full bg-brand-dark text-[10px] font-semibold text-on-brand">{{ initials(who.name) }}</span>
    </button>
    <button type="button" :class="cn(pill, 'px-2.5')" aria-label="Preferences" title="Preferences" @click="emit('prefs')"><SlidersHorizontal class="size-4" aria-hidden="true" /></button>
  </div>
</template>
