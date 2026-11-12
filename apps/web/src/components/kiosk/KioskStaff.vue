<script setup lang="ts">
// The staff's side of the kiosk, inside it (the Staff screen): answer quality, reviewing answers,
// the moderation queue, the team (chat and calls), your moderator profile and administration.
// Each needs a moderator key (administration: the administrator); visitors see a sign-in.
// The section is in the kiosk's address (/kiosk?screen=staff&staff=team), so links and the old
// /kiosk/curate, /kiosk/admin… addresses open the right one.
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import AdaptiveNav from "./AdaptiveNav.vue";
import CurateTimeline from "./CurateTimeline.vue";
import AdminPanel from "@/components/moderation/AdminPanel.vue";
import AnswerReviews from "@/components/moderation/AnswerReviews.vue";
import ModeratorProfile from "@/components/moderation/ModeratorProfile.vue";
import QualityDashboard from "@/components/moderation/QualityDashboard.vue";
import TeamPanel from "@/components/team/TeamPanel.vue";
import { useWidth } from "@/composables/width";

const SECTIONS = [
  { id: "quality", label: "Quality", icon: "gauge" },
  { id: "review", label: "Review answers", icon: "message-square" },
  { id: "moderation", label: "Moderation", icon: "search" },
  { id: "team", label: "Team", icon: "user-round" },
  { id: "profile", label: "My profile", icon: "notebook" },
  { id: "admin", label: "Administration", icon: "wrench" },
];
const route = useRoute();
const router = useRouter();
const { el, width } = useWidth();
const section = computed({
  get: () => (typeof route.query.staff === "string" && SECTIONS.some((s) => s.id === route.query.staff) ? route.query.staff : "quality"),
  // A section's own state (an open answer, a shared link) belongs to that section only.
  set: (id: string) => void router.replace({ path: "/kiosk", query: { screen: "staff", staff: id } }),
});
</script>

<template>
  <div ref="el">
    <AdaptiveNav v-model:active="section" :screens="SECTIONS" mode="tabs" storage-key="staff" :width="width">
      <template #quality><QualityDashboard /></template>
      <template #review><AnswerReviews /></template>
      <template #moderation><CurateTimeline /></template>
      <template #team><TeamPanel /></template>
      <template #profile><ModeratorProfile /></template>
      <template #admin><AdminPanel /></template>
    </AdaptiveNav>
  </div>
</template>
