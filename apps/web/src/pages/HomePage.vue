<script setup lang="ts">
import { Hand, MessageSquare, Video, Volume2 } from "@lucide/vue";
import PageSection from "@/components/site/PageSection.vue";

const OFFERINGS = [
  { image: "/incubator.png", title: "Incubation Center", body: "We setup an Incubation center to cultivate and nurture AI initiatives from concept stage to their evolution into impactful initiatives." },
  { image: "/tag.png", title: "Annotation & Curation", body: "We specialize in annotation and curation of the knowledge base to enable AI to produce high quality responses." },
  { image: "/agile-development.png", title: "Implement & Maintain", body: "We provide full services for implementation and long term maintenance of the AI services." },
  { image: "/conversation.png", title: "Consulting", body: "We are happy to share our experience to help lift-off on your AI Journey and jointly defining a roadmap to adapt for evolving trends in AI." },
];

const FEATURES = [
  { title: "Chat", icon: MessageSquare, color: "text-brand", description: "Interactive chat with Yaxb fetches the answer one's looking. It features multi-lingual capabilities with contextual memory making the communication very effective." },
  { title: "Video", icon: Video, color: "text-danger", description: "Yaxb information retrieval goes beyond just the plain text into videos and images. This enriches the experience of the conversation with pictures and images popping up in the interaction stepping the users into a meta verse." },
  { title: "Audio", icon: Volume2, color: "text-info", description: "Human like conversation makes the experience realistic and more connected with Yaxb. It emotes with fillers that makes the interaction very lively comforting the users to loosen up." },
  { title: "Gestures", icon: Hand, color: "text-success", description: "We are striving to enable conversation enabled with Gestures for instruction mapping. This helps make for interesting methods for shorter and quicker signal processing." },
];

const TEAM = [
  { avatar: "/kalai.jpg", name: "Dr. Kalaiarasi T", role: "Chief Executive Officer & MD", bio: "Kalai is a seasoned Healthcare professional with 20+ years of experience, who strives to bridge the gap between technology and patient care by leveraging AI. She envisioned the YAXB Self-Service AI Platform aimed to assist Doctors and Technicians in decision making from relevant contextual references." },
  { avatar: "/ramya.jpg", name: "P Sangeetha B.E", role: "Head of Technology", bio: "A Engineering Leader with 17+ years of experience in conceptualizing, designing and developing products. Over the years built expertise to deliver cutting-edge solutions by leveraging Digital, Data, Analytics, AI and ML technologies. FaceOPs platform was her brain child, which enables integration of AI seamlessly into the Digital touchpoints for the enterprises." },
  { avatar: "/sami.jpg", name: "Saminathan P", role: "Chief Operating Officer", bio: "Swaminathan has around 35 year of experience in various technology domains and has expertise in setting up & managing the large software development teams. Built the ML-OPS team for Yaxb from talent scouting to post delivery support." },
];
</script>

<template>
  <PageSection color="light" title-tag="h1" title="We focus on enabling AI interventions for enterprises through a tailored approach on our platform and seamlessly integrate into their ecosystem">
    <div class="relative isolate overflow-hidden rounded-xl bg-ink px-6 py-20 text-white md:py-28">
      <div aria-hidden="true" class="absolute inset-0 -z-10 bg-cover bg-center opacity-80" style="background-image: url(/headphone.jpg)" />
      <div class="flex flex-wrap items-center justify-center gap-8">
        <p class="text-3xl font-semibold drop-shadow md:text-4xl">Let us explore...</p>
        <RouterLink to="/kiosk" class="btn bg-white px-6 py-3 text-base text-ink hover:bg-mist">Try me</RouterLink>
      </div>
    </div>
    <header class="mt-14 mb-10 text-center">
      <h2 class="text-3xl font-semibold text-balance md:text-5xl">Self-Service AI Platform</h2>
      <p class="mx-auto mt-4 max-w-3xl text-lg text-pretty opacity-80">Integrate Yaxb seamlessly into your digital world and elevate the experience using AI with support of multi-modal interactions like Text, Voice, Audio, Video and Gestures</p>
    </header>
  </PageSection>

  <PageSection id="explore" title="Our Offerings on the Self Service AI Platform">
    <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
      <article v-for="item in OFFERINGS" :key="item.title">
        <img :src="item.image" alt="" class="aspect-[4/3] w-full object-contain" loading="lazy" />
        <h3 class="mt-5 text-lg font-medium text-ink">{{ item.title }}</h3>
        <p class="mt-3 text-sm leading-relaxed">{{ item.body }}</p>
      </article>
    </div>
  </PageSection>

  <PageSection id="about" title="Yaxb Features">
    <div class="grid items-center gap-12 lg:grid-cols-2">
      <img src="/chat.svg" alt="Illustration" class="mx-auto max-h-[28rem] w-full object-contain" loading="lazy" />
      <div class="space-y-8">
        <div v-for="f in FEATURES" :key="f.title" class="flex items-start gap-5">
          <component :is="f.icon" :class="['size-8 shrink-0', f.color]" aria-hidden="true" />
          <div>
            <h3 class="text-lg font-bold text-ink">{{ f.title }}</h3>
            <p class="mt-1 text-gray-500">{{ f.description }}</p>
          </div>
        </div>
      </div>
    </div>
  </PageSection>

  <PageSection color="light" background-image="/backgroundcard.jpeg" :background-image-opacity="0.8" title="Meet the Team">
    <div class="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      <article v-for="m in TEAM" :key="m.name" class="card flex flex-col items-center p-7 text-center">
        <img :src="m.avatar" :alt="m.name" width="128" height="128" class="size-32 rounded-full object-cover" loading="lazy" />
        <p class="mt-5 text-lg text-ink">{{ m.name }}</p>
        <p class="text-xs font-semibold tracking-wide uppercase">{{ m.role }}</p>
        <p class="mt-5 text-sm leading-relaxed">{{ m.bio }}</p>
      </article>
    </div>
  </PageSection>
</template>
