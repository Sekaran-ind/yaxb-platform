<script setup lang="ts">
// A staff section inside Services (For staff): answer quality, reviewing answers, the moderation
// queue, the journey library, the team (chat and calls), your moderator profile, or administration. Each needs a
// moderator key (administration: the administrator); visitors see a sign-in. The Services list is
// the menu: this shows the one section in the kiosk's address (/kiosk?screen=services&staff=team),
// so links and the old /kiosk/curate, /kiosk/admin… addresses open it.
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import { computed } from "vue";
import { useRoute } from "vue-router";
import CurateTimeline from "./CurateTimeline.vue";
import AdminPanel from "@/components/moderation/AdminPanel.vue";
import AnswerReviews from "@/components/moderation/AnswerReviews.vue";
import LibraryPanel from "@/components/library/LibraryPanel.vue";
import ModeratorProfile from "@/components/moderation/ModeratorProfile.vue";
import QualityDashboard from "@/components/moderation/QualityDashboard.vue";
import TeamPanel from "@/components/team/TeamPanel.vue";
import { iconFor } from "@/lib/icons";

const COMPONENTS = { quality: QualityDashboard, review: AnswerReviews, moderation: CurateTimeline, library: LibraryPanel, team: TeamPanel, profile: ModeratorProfile, admin: AdminPanel } as const;
type Section = keyof typeof COMPONENTS;

const route = useRoute();
const section = computed<Section>(() => (typeof route.query.staff === "string" && route.query.staff in COMPONENTS ? (route.query.staff as Section) : "quality"));
/** The section's name and icon, from its card in the For staff service. */
const item = computed(() => kioskContent.services.find((s) => s.id === "staff")?.items.find((i) => i.staff === section.value));
</script>

<template>
  <section :aria-labelledby="`staff-${section}`" class="@container space-y-3">
    <h2 :id="`staff-${section}`" class="flex items-center gap-2 text-base font-semibold text-ink">
      <component :is="iconFor(item?.icon)" v-if="iconFor(item?.icon)" class="size-4 text-brand" aria-hidden="true" />{{ item?.label ?? "Staff" }}
    </h2>
    <component :is="COMPONENTS[section]" />
  </section>
</template>
