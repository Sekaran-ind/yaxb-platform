<script setup lang="ts">
import PageSection from "@/components/site/PageSection.vue";
</script>

<template>
  <PageSection size="large">
    <div class="text-center">
      <h1 class="text-4xl font-semibold text-ink">Page not found</h1>
      <p class="mt-4">The page you are looking for doesn't exist.</p>
      <RouterLink to="/" class="btn-primary mt-8">Go home</RouterLink>
    </div>
  </PageSection>
</template>
