<script setup lang="ts">
import QualityDashboard from "@/components/moderation/QualityDashboard.vue";
import PageSection from "@/components/site/PageSection.vue";
</script>

<template>
  <PageSection size="normal" title-tag="h1" title="Answer quality" subtitle="F1, precision, recall and accuracy per notebook, from moderators' reviews.">
    <div class="mx-auto max-w-4xl"><QualityDashboard /></div>
  </PageSection>
</template>
