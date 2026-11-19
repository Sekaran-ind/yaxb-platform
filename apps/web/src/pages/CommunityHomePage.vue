<script setup lang="ts">
// Anjal Community's home page (EDN-4): for apartment associations, clubs, places of worship's
// committees, self-help and parents' groups. Its own words: residents and members, the committee,
// blocks, the hall, notices. How it works, ideas to start from, what the committee may and may not
// see, and the contact form.
import { ArrowRightLeft, BookOpen, Lock, Megaphone, UserPlus } from "@lucide/vue";
import HeroCarousel from "@/components/home/HeroCarousel.vue";
import IdeasSlides from "@/components/home/IdeasSlides.vue";
import ContactPanel from "@/components/site/ContactPanel.vue";
import PageSection from "@/components/site/PageSection.vue";

const STEPS = [
  { icon: BookOpen, title: "Fill the notebook", body: "The secretary adds the bylaws, rules, vendor list and circulars once. Residents ask about them in their own language, with the clause cited." },
  { icon: UserPlus, title: "Bring the committee", body: "Send join links for each role: secretary, treasurer, committee member. You accept who joins; each gets their own key." },
  { icon: ArrowRightLeft, title: "Complaints and bookings", body: "A resident raises a complaint or books the hall; it goes to the right committee member with a reference, and its status stays in the conversation." },
  { icon: Megaphone, title: "Notices that reach everyone", body: "Circulars go into the notebook, so every resident can ask about them in Tamil, Hindi or English, on the kiosk or their phone." },
];
const PRINCIPLES = [
  { title: "The committee sees its work only", body: "Complaints, bookings and dues that come to it. Never a resident's own notebook, conversations or family data." },
  { title: "Facts, with sources", body: "Answers say what the bylaws, the minutes or a notice say, and name them. No opinions of the kiosk's own." },
  { title: "Your devices first", body: "Requests stay on the committee's devices or your own box. The cloud is a transient relay; central storage is the paid plan." },
  { title: "Fair by design", body: "Every service is checked for treating people differently by caste, religion or gender, and a reviewer must give a lawful reason to publish one that does." },
];
</script>

<template>
  <HeroCarousel />

  <PageSection id="how" title="How a community runs on Anjal" subtitle="Four steps, all in the kiosk.">
    <ol class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <li v-for="(s, i) in STEPS" :key="s.title" class="card p-5">
        <p class="text-xs font-semibold tracking-wide text-gray-500">STEP {{ i + 1 }}</p>
        <h3 class="mt-2 flex items-center gap-2 font-semibold text-ink"><component :is="s.icon" class="size-4 text-brand" aria-hidden="true" /> {{ s.title }}</h3>
        <p class="mt-1.5 text-sm leading-relaxed text-gray-600">{{ s.body }}</p>
      </li>
    </ol>
  </PageSection>

  <PageSection id="ideas" color="light" title="Ideas for your community" subtitle="Pick one and the AI designer drafts its services for the committee to change. Publish them, and residents start them from any kiosk or phone.">
    <IdeasSlides only="community" />
  </PageSection>

  <PageSection id="privacy" color="dark" title="Private by design" subtitle="What the committee may see, and what it never may.">
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
