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
const CATALOGUE = [
  { eyebrow: "Design", title: "A service, its journeys, their screens", body: "Anyone can start: add journeys to a service and screens to each journey, with the questions people answer." },
  { eyebrow: "Roles", title: "Who starts and who finishes", body: "Add the roles that deliver the service as you design, and assign each journey to the roles that start and complete it." },
  { eyebrow: "Publish", title: "Reviewed, then on the kiosk", body: "A reviewer accepts it; any kiosk can then load the service and guide people through its journeys." },
];
</script>

<template>
  <section class="relative isolate overflow-hidden">
    <div aria-hidden="true" class="absolute inset-x-0 -top-40 -z-10 h-[36rem] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-brand)_18%,transparent),transparent_70%)]" />
    <div class="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 md:pt-24 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <p class="eyebrow">Self-service AI platform</p>
        <h1 class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance text-ink md:text-6xl">Answers people can trust, at every kiosk.</h1>
        <p class="mt-6 max-w-xl text-lg text-pretty text-gray-600">
          We enable AI interventions for enterprises through a tailored approach on our platform, integrated seamlessly into your ecosystem: answers grounded in your own knowledge and cited every time, by voice or text, in fourteen languages.
        </p>
        <div class="mt-9 flex flex-wrap items-center gap-3">
          <RouterLink to="/kiosk" class="btn-primary h-11 px-6">Try the kiosk</RouterLink>
          <RouterLink to="/catalogue" class="btn-light h-11 px-5">Design a service</RouterLink>
          <a href="#explore" class="btn-ghost h-11 px-5">What we offer →</a>
        </div>
        <dl class="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-gray-200/70 pt-6 text-sm">
          <div><dt class="text-gray-500">Languages</dt><dd class="mt-1 text-xl font-semibold tracking-tight text-ink">14</dd></div>
          <div><dt class="text-gray-500">Answers</dt><dd class="mt-1 text-xl font-semibold tracking-tight text-ink">Cited</dd></div>
          <div><dt class="text-gray-500">On device</dt><dd class="mt-1 text-xl font-semibold tracking-tight text-ink">Private</dd></div>
        </dl>
      </div>
      <div class="console mx-auto w-full max-w-md px-7 py-9" aria-hidden="true">
        <div class="flex items-center justify-between">
          <p class="text-[10px] font-semibold tracking-[0.22em] text-white/50 uppercase">YAXB Kiosk</p>
          <span class="inline-flex items-center gap-1.5 text-[11px] text-white/60"><span class="size-1.5 rounded-full bg-brand" /> Listening</span>
        </div>
        <p class="mt-10 text-2xl font-medium tracking-tight text-white">“How much is holiday pay?”</p>
        <div class="mt-8 flex h-14 items-center gap-[3px]">
          <span v-for="i in 34" :key="i" class="voice-bar voice-bar-live" :style="{ height: `${30 + 70 * Math.sin((Math.PI * i) / 34) ** 1.5}%`, animationDelay: `${((i * 137) % 100) / 100}s` }" />
        </div>
        <div class="mt-8 rounded-2xl bg-white/5 p-4 text-sm leading-relaxed text-white/80 ring-1 ring-white/10">
          Work on a declared holiday is paid at twice the daily wage.
          <span class="mt-3 flex gap-1.5"><span class="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">Wages policy · 4.2</span></span>
        </div>
      </div>
    </div>
  </section>

  <PageSection id="explore" title="What we offer" subtitle="From the first idea to a kiosk in daily use.">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <article v-for="item in OFFERINGS" :key="item.title" class="card p-6">
        <div class="grid size-14 place-items-center rounded-2xl bg-mist ring-1 ring-gray-200/70"><img :src="item.image" alt="" class="size-8 object-contain" loading="lazy" /></div>
        <h3 class="mt-5 text-base font-semibold text-ink">{{ item.title }}</h3>
        <p class="mt-2 text-sm leading-relaxed text-gray-600">{{ item.body }}</p>
      </article>
    </div>
  </PageSection>

  <PageSection id="catalogue" color="light" title="The Service Catalogue" subtitle="Design a service once; run it on any kiosk.">
    <div class="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
      <article v-for="step in CATALOGUE" :key="step.title" class="card p-6">
        <p class="eyebrow">{{ step.eyebrow }}</p>
        <h3 class="mt-2 text-base font-semibold text-ink">{{ step.title }}</h3>
        <p class="mt-2 text-sm leading-relaxed text-gray-600">{{ step.body }}</p>
      </article>
    </div>
    <div class="mt-8 text-center"><RouterLink to="/catalogue" class="btn-primary h-11 px-6">Open the Service Catalogue</RouterLink></div>
  </PageSection>

  <PageSection id="about" title="How people talk to YAXB">
    <div class="grid items-center gap-12 lg:grid-cols-2">
      <img src="/chat.svg" alt="Illustration" class="mx-auto max-h-[28rem] w-full object-contain" loading="lazy" />
      <div class="space-y-8">
        <div v-for="f in FEATURES" :key="f.title" class="flex items-start gap-5">
          <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-mist ring-1 ring-gray-200/70"><component :is="f.icon" class="size-5 text-ink" aria-hidden="true" /></span>
          <div>
            <h3 class="text-base font-semibold text-ink">{{ f.title }}</h3>
            <p class="mt-1 text-sm leading-relaxed text-gray-600">{{ f.description }}</p>
          </div>
        </div>
      </div>
    </div>
  </PageSection>

  <PageSection color="light" title="Meet the team">
    <div class="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      <article v-for="m in TEAM" :key="m.name" class="card flex flex-col items-center p-7 text-center">
        <img :src="m.avatar" :alt="m.name" width="96" height="96" class="size-24 rounded-full object-cover ring-4 ring-mist" loading="lazy" />
        <p class="mt-5 text-base font-semibold tracking-tight text-ink">{{ m.name }}</p>
        <p class="eyebrow mt-1">{{ m.role }}</p>
        <p class="mt-4 text-sm leading-relaxed text-gray-600">{{ m.bio }}</p>
      </article>
    </div>
  </PageSection>
</template>
