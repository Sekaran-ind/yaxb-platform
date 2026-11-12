<script setup lang="ts">
import CurateTimeline from "@/components/kiosk/CurateTimeline.vue";
import PageSection from "@/components/site/PageSection.vue";
</script>

<template>
  <PageSection size="normal" title-tag="h1" title="Curate & Moderate" subtitle="Escalated questions and the curated answer timeline.">
    <div class="mx-auto max-w-3xl"><CurateTimeline /></div>
  </PageSection>
</template>
