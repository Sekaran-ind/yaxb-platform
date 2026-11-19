<script setup lang="ts">
// Anjal for Business's home page (SUR-2): the small-business story and what's in the kiosk for a
// business, ideas for services to design, how it handles customers' data, and the contact form.
// Nothing about families: they have their own surface.
import { ArrowRightLeft, Lock, ShieldCheck, Sparkles, UserPlus } from "@lucide/vue";
import HeroCarousel from "@/components/home/HeroCarousel.vue";
import IdeasSlides from "@/components/home/IdeasSlides.vue";
import ContactPanel from "@/components/site/ContactPanel.vue";
import MeetAnjalai from "@/components/site/MeetAnjalai.vue";
import PageSection from "@/components/site/PageSection.vue";

const STEPS = [
  { icon: Sparkles, title: "Describe a service", body: "The AI designer drafts its journeys, screens and roles; the Legal Guardian writes the consent forms." },
  { icon: UserPlus, title: "Bring your team", body: "Send join links for each role. You accept who joins; each person gets their own key." },
  { icon: ArrowRightLeft, title: "Serve customers", body: "Customers ask in their own language and start requests; each goes to the right person, with a reference." },
  { icon: ShieldCheck, title: "See how it goes", body: "My work for staff, and a dashboard per service: completion, waits and outcomes. The audit log shows if any record was changed afterwards." },
];
const PRINCIPLES = [
  { title: "Facts, not opinions", body: "Answers say what a source says and name it. No advice of the kiosk's own." },
  { title: "Your devices first", body: "Requests stay on your team's devices or your own box. The cloud is a transient relay; central storage is the paid plan." },
  { title: "Consent and fairness", body: "Every service carries a consent form per role, and an ethics check: a reviewer must give a lawful reason to publish one that treats people differently." },
  { title: "Keys stay on the server", body: "AI and search keys never reach a browser; staff keys are shown once and stored hashed." },
];
</script>

<template>
  <HeroCarousel />
  <MeetAnjalai />

  <PageSection id="how" title="From an idea to a running service" subtitle="Four steps, all in the kiosk.">
    <ol class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <li v-for="(s, i) in STEPS" :key="s.title" class="card p-5">
        <p class="text-xs font-semibold tracking-wide text-gray-500">STEP {{ i + 1 }}</p>
        <h3 class="mt-2 flex items-center gap-2 font-semibold text-ink"><component :is="s.icon" class="size-4 text-brand" aria-hidden="true" /> {{ s.title }}</h3>
        <p class="mt-1.5 text-sm leading-relaxed text-gray-600">{{ s.body }}</p>
      </li>
    </ol>
  </PageSection>

  <PageSection id="ideas" color="light" title="Ideas for your Service Catalogue" subtitle="Pick one and the AI designer drafts it for you to change. Publish it, and customers can start it from any kiosk.">
    <IdeasSlides only="business" />
  </PageSection>

  <PageSection id="privacy" color="dark" title="Private by design" subtitle="The same rules behind every kiosk, every service and every answer.">
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
