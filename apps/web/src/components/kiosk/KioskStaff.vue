<script setup lang="ts">
// The staff sections inside Services (For staff): answer quality, reviewing answers, the moderation
// queue, the team (chat and calls), your moderator profile, and administration. Each needs a
// moderator key (administration: the administrator); visitors see a sign-in. They are siblings, so
// they share one adaptive nav (tabs, a section menu when narrow) instead of each panel linking to
// the others. The section is in the kiosk's address (/kiosk?screen=services&staff=team), so links and
// the old /kiosk/curate, /kiosk/admin… addresses open it.
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import { AdaptiveNav, type NavScreen } from "@sekaran-ind/yaxb-journeys/vue";
import { ArrowLeft } from "@lucide/vue";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import CurateTimeline from "./CurateTimeline.vue";
import AdminPanel from "@/components/moderation/AdminPanel.vue";
import AnswerReviews from "@/components/moderation/AnswerReviews.vue";
import ModeratorProfile from "@/components/moderation/ModeratorProfile.vue";
import QualityDashboard from "@/components/moderation/QualityDashboard.vue";
import TeamPanel from "@/components/team/TeamPanel.vue";
import { useWidth } from "@/composables/width";

const COMPONENTS = { quality: QualityDashboard, review: AnswerReviews, moderation: CurateTimeline, team: TeamPanel, profile: ModeratorProfile, admin: AdminPanel } as const;
type Section = keyof typeof COMPONENTS;
const isSection = (s: unknown): s is Section => typeof s === "string" && s in COMPONENTS;

const route = useRoute();
const router = useRouter();
const section = computed<Section>(() => (isSection(route.query.staff) ? route.query.staff : "quality"));
/** The sections, named and drawn as their cards in the For staff service. */
const screens = computed<NavScreen[]>(() =>
  (kioskContent.services.find((s) => s.id === "staff")?.items ?? []).filter((i) => isSection(i.staff)).map((i) => ({ id: i.staff!, label: i.label, icon: i.icon })),
);
// Another section starts afresh: only the kiosk's screen is kept from the address.
const open = (id: string) => void router.push({ path: "/kiosk", query: { screen: "services", staff: id } });
const { el, width } = useWidth(900);
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <section ref="el" aria-label="For staff">
    <AdaptiveNav :screens="screens" mode="tabs" storage-key="staff" label="Staff sections" :active="section" :width="width" @update:active="open">
      <!-- The way back to Services sits on the same row as the sections (one header, not two). -->
      <template #lead>
        <button type="button" class="btn-ghost -ml-2 h-10 shrink-0 px-2 text-sm" @click="emit('back')"><ArrowLeft class="size-4" aria-hidden="true" /> Quick tools</button>
      </template>
      <template v-for="s in screens" :key="s.id" #[s.id]>
        <component :is="COMPONENTS[s.id as Section]" />
      </template>
    </AdaptiveNav>
  </section>
</template>
