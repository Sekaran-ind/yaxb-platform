<script setup lang="ts">
// The Service Catalogue's player (ConsolePlayer), where the kiosk has its own: the same anatomy,
// with the catalogue's content (docs/ux/patterns.md, Players).
//   status    "now playing": what the catalogue is while you browse, the service while you design it
//   under     full: the open service's state, and the designer's step
//   body      full, browsing: how a service gets to a kiosk (Design, Review, Load)
//   meta      the counts while browsing; the state and step while designing (strip and mini)
//   controls  the personal button: Staff sign in for a guest, your initials (sign out) for a member
//   actions   Open the kiosk, and New service (the primary, the large brand circle)
//   foot      full: who you are, in words
import { Library, LogIn, MonitorSmartphone, PencilRuler, Plus, SlidersHorizontal } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";
import ConsolePlayer from "@/components/site/ConsolePlayer.vue";

const props = withDefaults(
  defineProps<{
    who: { name: string; guest: boolean; roles: string } | null;
    counts: { published: number; mine: number; review: number | null };
    /** The service open on the right, if any. */
    current: { title: string; status: string } | null;
    /** The designer's step, while designing. */
    step?: { index: number; total: number; label: string } | null;
    loading?: boolean;
    signingIn?: boolean;
    variant?: "full" | "strip" | "mini";
  }>(),
  { variant: "full", step: null },
);
const emit = defineEmits<{ newService: []; signIn: []; signOut: [] }>();

const STEPS = [
  { n: 1, title: "Design", body: "A service, its journeys, their screens and questions." },
  { n: 2, title: "Review", body: "A reviewer tries it and publishes it." },
  { n: 3, title: "Load", body: "Any kiosk loads it from here." },
];
const status = computed(() => (props.loading ? "Loading the catalogue" : (props.current?.title ?? "Ready to design")));
const stepText = computed(() => (props.step ? `Step ${props.step.index + 1} of ${props.step.total}: ${props.step.label}` : ""));
const countsText = computed(() => {
  const c = props.counts;
  return [`${c.published} published`, `${c.mine} ${props.who?.guest ? "yours" : "in all"}`, ...(c.review === null ? [] : [`${c.review} in review`])].join(" · ");
});
// Full shows the state and step under the status, so its meta line keeps the counts.
const metaText = computed(() => (props.current && props.variant !== "full" ? [props.current.status, stepText.value].filter(Boolean).join(" · ") : countsText.value));
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const big = computed(() => props.variant === "full");
</script>

<template>
  <ConsolePlayer :variant="variant" eyebrow="YAXB Service Catalogue" :status="status" :busy="loading" label="Catalogue player">
    <template #controls>
      <button
        v-if="!who || who.guest"
        type="button"
        :class="cn('grid size-9 shrink-0 place-items-center rounded-full ring-1 transition', signingIn ? 'bg-white text-console ring-white' : 'bg-white/5 text-white/80 ring-white/15 hover:bg-white/10 hover:text-white')"
        :aria-pressed="signingIn"
        aria-label="Staff sign in"
        title="Staff sign in: see every service, review and manage roles"
        @click="emit('signIn')"
      >
        <LogIn class="size-4" aria-hidden="true" />
      </button>
      <button
        v-else
        type="button"
        class="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-console ring-1 ring-brand/40 transition hover:brightness-110"
        :aria-label="`Signed in as ${who.name}. Sign out`"
        :title="`${who.name} (${who.roles || 'no roles'}): sign out`"
        @click="emit('signOut')"
      >
        {{ initials(who.name) }}
      </button>
    </template>

    <template #orb="{ size }">
      <PencilRuler v-if="current" :class="cn('text-white/85', size)" aria-hidden="true" />
      <Library v-else :class="cn('text-white/85', size)" aria-hidden="true" />
    </template>

    <template v-if="variant === 'full' && current" #under-status>
      <p class="mt-2 text-sm text-white/70">{{ current.status }}</p>
      <p v-if="stepText" class="mt-1 text-xs text-white/60">{{ stepText }}</p>
    </template>

    <template #meta>{{ metaText }}</template>

    <template #body>
      <p v-if="!current" class="max-w-xs text-center text-sm text-white/70">Design once. Run on any kiosk.</p>
      <ol v-if="!current" class="w-full max-w-xs space-y-2.5 text-left">
        <li v-for="s in STEPS" :key="s.n" class="flex gap-3">
          <span class="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white">{{ s.n }}</span>
          <span class="min-w-0">
            <span class="block text-sm font-medium text-white">{{ s.title }}</span>
            <span class="block text-xs leading-relaxed text-white/60">{{ s.body }}</span>
          </span>
        </li>
      </ol>
      <p v-else class="max-w-xs text-center text-xs leading-relaxed text-white/60">Go through the steps with Next. The preview beside them shows what a visitor sees. Save, then submit for review.</p>
    </template>

    <template #actions>
      <!-- Captions share one line under the circles. -->
      <span :class="cn('flex', big ? 'items-end gap-5' : 'items-center gap-2')">
      <span class="flex flex-col items-center gap-1.5">
        <RouterLink to="/kiosk" :class="cn('console-btn', big ? 'size-12' : 'size-9')" aria-label="Open the kiosk" title="Open the kiosk">
          <MonitorSmartphone :class="big ? 'size-5' : 'size-4'" aria-hidden="true" />
        </RouterLink>
        <span v-if="big" class="text-[11px] text-white/60" aria-hidden="true">Open the kiosk</span>
      </span>
      <!-- The same preferences as the kiosk (model, layout, theme, voice), opening here. -->
      <span class="flex flex-col items-center gap-1.5">
        <RouterLink :to="{ path: '/catalogue', query: { ...$route.query, prefs: 'model' } }" :class="cn('console-btn', big ? 'size-12' : 'size-9')" aria-label="Preferences" title="Preferences">
          <SlidersHorizontal :class="big ? 'size-5' : 'size-4'" aria-hidden="true" />
        </RouterLink>
        <span v-if="big" class="text-[11px] text-white/60" aria-hidden="true">Preferences</span>
      </span>
      <span class="flex flex-col items-center gap-1.5">
        <button
          type="button"
          :class="cn('flex items-center justify-center rounded-full bg-brand text-console transition duration-200 hover:brightness-110', big ? 'size-20 shadow-[0_0_40px_-6px_var(--color-brand)]' : 'size-11')"
          aria-label="New service"
          title="New service"
          @click="emit('newService')"
        >
          <Plus :class="big ? 'size-8' : 'size-5'" aria-hidden="true" />
        </button>
        <span v-if="big" class="text-[11px] font-medium text-white/80" aria-hidden="true">New service</span>
      </span>
      </span>
    </template>

    <template v-if="who" #foot>
      <p class="max-w-xs text-center text-xs text-white/60">{{ who.guest ? "Designing as a guest: your services stay with this browser." : `${who.name} · ${who.roles || "no roles"}` }}</p>
    </template>
  </ConsolePlayer>
</template>
