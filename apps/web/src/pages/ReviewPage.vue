<script setup lang="ts">
import AnswerReviews from "@/components/moderation/AnswerReviews.vue";
import PageSection from "@/components/site/PageSection.vue";
</script>

<template>
  <PageSection size="normal" title-tag="h1" title="Review answers" subtitle="Rate answers, mark their sources, and add what they missed.">
    <div class="mx-auto max-w-3xl"><AnswerReviews /></div>
  </PageSection>
</template>
