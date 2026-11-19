<script setup lang="ts">
// The Service Catalogue's player (ConsolePlayer), read like the kiosk's (PlayerPanel): the
// catalogue's mark, what is open ("now playing": the catalogue, or the service being designed and
// its step), the counts, and its controls as round console buttons (PlayerButtons, PLY-2..3):
// New service (opens Ask Me to design it in the conversation), Open the kiosk, the staff sign-in
// (or your initials, to sign out) and Preferences. Full labels them, Pod shows icons, Mini shows
// the staff button and More.
import { Library, LogIn, MonitorSmartphone, PencilRuler, Plus, SlidersHorizontal } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/cn";
import ConsolePlayer from "@/components/site/ConsolePlayer.vue";
import PlayerButtons, { type PlayerButton } from "@/components/kiosk/PlayerButtons.vue";

const props = withDefaults(
  defineProps<{
    who: { name: string; guest: boolean; roles: string } | null;
    counts: { published: number; mine: number; review: number | null };
    /** The service open on the right, if any. */
    current: { title: string; status: string } | null;
    /** The designer's step, while designing. */
    step?: { index: number; total: number; label: string } | null;
    loading?: boolean;
    variant?: "full" | "strip" | "mini";
    /** A published service is open: Open the kiosk loads it. */
    loadEntry?: string | null;
    signingIn?: boolean;
    prefsOpen?: boolean;
  }>(),
  { variant: "full", step: null, loadEntry: null },
);
const emit = defineEmits<{ newService: []; kiosk: []; signIn: []; signOut: []; prefs: [] }>();

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
/** The staff button goes first (Mini keeps it, as the kiosk keeps the profile). */
const buttons = computed<PlayerButton[]>(() => [
  props.who && !props.who.guest
    ? { id: "profile", label: `${props.who.name}: sign out`, initials: initials(props.who.name), accent: true }
    : { id: "profile", label: "Staff sign in", icon: LogIn, pressed: props.signingIn },
  { id: "new", label: "New service", icon: Plus },
  { id: "kiosk", label: props.loadEntry ? "Open in the kiosk" : "Open the kiosk", icon: MonitorSmartphone },
  { id: "prefs", label: "Preferences", icon: SlidersHorizontal, pressed: props.prefsOpen },
]);
function pick(id: string) {
  if (id === "profile") return props.who && !props.who.guest ? emit("signOut") : emit("signIn");
  if (id === "new") return emit("newService");
  if (id === "kiosk") return emit("kiosk");
  if (id === "prefs") return emit("prefs");
}
</script>

<template>
  <ConsolePlayer :variant="variant" eyebrow="Anjal - Service Catalogue" :status="status" :busy="loading" label="Catalogue player">
    <template #orb="{ size }">
      <PencilRuler v-if="current" :class="cn('text-white/85', size)" aria-hidden="true" />
      <Library v-else :class="cn('text-white/85', size)" aria-hidden="true" />
    </template>

    <template v-if="variant === 'full' && current" #under-status>
      <p class="mt-2 text-sm text-white/70">{{ current.status }}</p>
      <p v-if="stepText" class="mt-1 text-xs text-white/60">{{ stepText }}</p>
    </template>

    <template #meta>{{ metaText }}</template>

    <template #actions><PlayerButtons :buttons="buttons" :variant="variant" @pick="pick" /></template>
  </ConsolePlayer>
</template>
