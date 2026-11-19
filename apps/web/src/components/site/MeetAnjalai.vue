<script setup lang="ts">
// "Meet Anjalai": the companion's character and its one-line story (20 words), on the portal and on
// each edition's home page. Theme tokens only, so it sits well on any page and in every theme.
import AnjalaiCharacter from "./AnjalaiCharacter.vue";
import BrandText from "./BrandText.vue";
import { SITE_WIDTH } from "@/lib/site-width";

/** The story: 20 words. */
const STORY = "is your fearless companion: by your side always, helping you every step of the way, keeping what's yours safe.";
</script>

<template>
  <section id="meet-anjalai" aria-labelledby="meet-anjalai-title" class="py-12 md:py-16">
    <div :class="['mx-auto', SITE_WIDTH]">
      <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 rounded-[2rem] bg-surface p-6 text-center ring-1 ring-gray-200/80 sm:flex-row sm:gap-10 sm:p-10 sm:text-left">
        <AnjalaiCharacter :size="180" class="shrink-0" />
        <div>
          <p class="eyebrow">Meet your companion</p>
          <h2 id="meet-anjalai-title" class="mt-2 text-3xl font-bold tracking-[-0.03em] text-ink md:text-4xl"><BrandText text="Anjalai" /></h2>
          <p class="mt-3 text-xl leading-relaxed text-pretty text-body md:text-2xl"><BrandText text="Anjalai" /> {{ STORY }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
