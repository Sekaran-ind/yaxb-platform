<script setup lang="ts">
// Anjal Family's home page (SUR-2): the family story and what's in the kiosk for a home, ideas for
// families (notebooks to keep), how a family's data stays private, and the contact form. Nothing
// about businesses: they have their own surface.
import { Baby, Lock } from "@lucide/vue";
import HeroCarousel from "@/components/home/HeroCarousel.vue";
import IdeasSlides from "@/components/home/IdeasSlides.vue";
import ContactPanel from "@/components/site/ContactPanel.vue";
import PageSection from "@/components/site/PageSection.vue";

const PRINCIPLES = [
  { title: "Each person's own", body: "Every profile keeps its own notebook, Scheduler and conversations, encrypted on the device." },
  { title: "Your devices first", body: "Notebooks and the Scheduler stay on your devices or your own box. The cloud is the last resort." },
  { title: "Facts, with sources", body: "Answers say what your documents or trusted sources say, and name them. No advice of the kiosk's own." },
  { title: "Safe for children", body: "The child safety lock keeps answers child-friendly, turns off the web, and locks the settings behind a parent's PIN." },
];
</script>

<template>
  <HeroCarousel />

  <PageSection id="ideas" title="Ideas for your family" subtitle="What to keep in a family notebook, and what the kiosk can do with it.">
    <IdeasSlides only="family" />
  </PageSection>

  <PageSection id="children" color="light">
    <div class="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
      <span class="grid size-12 place-items-center rounded-full bg-surface ring-1 ring-gray-200"><Baby class="size-6 text-brand" aria-hidden="true" /></span>
      <h2 class="text-2xl font-semibold tracking-[-0.03em] text-balance text-ink md:text-3xl">Children use it too</h2>
      <p class="text-pretty text-gray-600">Give a child their own profile (Under 18), or turn on the child safety lock with a parent's PIN. Answers stay simple and kind, the web stays off, and worrying questions go to a trusted adult.</p>
      <RouterLink to="/kiosk" class="btn-primary h-11 px-6">Try the kiosk</RouterLink>
    </div>
  </PageSection>

  <PageSection id="privacy" color="dark" title="Private by design" subtitle="The rules behind every answer in your home.">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="p in PRINCIPLES" :key="p.title" class="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <Lock class="size-5 text-white/60" aria-hidden="true" />
        <h3 class="mt-4 text-base font-semibold text-white">{{ p.title }}</h3>
        <p class="mt-2 text-sm leading-relaxed text-white/70">{{ p.body }}</p>
      </div>
    </div>
  </PageSection>

  <PageSection id="contact" size="normal">
    <div class="card"><ContactPanel /></div>
  </PageSection>
</template>
