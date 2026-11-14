<script setup lang="ts">
// The home page: the carousel (Anjal, a family, a small business, the kiosk's features), ideas for
// services people can design in the Service Catalogue, ClinüxFlow for regulated healthcare, Anjal's
// two sides (a banner and a dialog), how
// data is kept, and the contact form.
import { ExternalLink, Lock, ShieldCheck } from "@lucide/vue";
import HeroCarousel from "@/components/home/HeroCarousel.vue";
import IdeasSlides from "@/components/home/IdeasSlides.vue";
import TwoSides from "@/components/home/TwoSides.vue";
import ContactPanel from "@/components/site/ContactPanel.vue";
import PageSection from "@/components/site/PageSection.vue";
import { CLINUX_URL } from "@/lib/legal";

const CLINUX_SAFEGUARDS = [
  { title: "FHIR at the core", body: "Records are FHIR R4, checked against published profiles, so they stay portable." },
  { title: "Built for ABDM", body: "HPR, HFR, ABHA and consent flows run against the ABDM sandbox today. Certification is still ahead." },
  { title: "Standard terminology", body: "SNOMED CT, LOINC, ICD-10 and UCUM, so a record means the same wherever it goes." },
  { title: "Consent comes first", body: "People agree in plain words, under India's DPDP Act, 2023, can withdraw, and nothing is shared without their say-so." },
  { title: "Local first, sealed in transit", body: "Data lives on the device or the clinic's network first. Sensitive fields are sealed before they leave." },
  { title: "A pack for each country", body: "Designed around the International Patient Summary, with each country's consent wording, identifiers and rules." },
];

const PRINCIPLES = [
  { title: "Facts, not opinions", body: "Answers say what a source says and name it. No advice of the kiosk's own." },
  { title: "Your devices first", body: "Notebooks, profiles and requests stay on your devices or your own box. The cloud is the last resort." },
  { title: "Untrusted text stays data", body: "Instructions hidden in a document or web page are never followed." },
  { title: "Keys stay on the server", body: "AI and search keys never reach a browser; staff keys are shown once and stored hashed." },
];
</script>

<template>
  <HeroCarousel />

  <!-- Ideas for the Service Catalogue -->
  <PageSection id="ideas" title="Ideas for your Service Catalogue" subtitle="Pick one and the AI designer drafts it for you to change. Publish it, and customers can start it from any kiosk.">
    <IdeasSlides />
  </PageSection>

  <!-- Regulated industries: ClinüxFlow -->
  <PageSection id="clinux" color="light">
    <div class="grid items-start gap-12 lg:grid-cols-[1fr_1.4fr]">
      <div>
        <p class="eyebrow">For regulated care</p>
        <h2 class="mt-3 text-2xl font-semibold tracking-[-0.03em] text-balance text-ink md:text-3xl">Healthcare needs more. That's ClinüxFlow.</h2>
        <p class="mt-4 text-pretty text-gray-600">
          ClinüxFlow grew from this kiosk: a guide beside every person (its assistant, Cübo), journeys one step at a time, records kept close. It is built for care, where industry standards and regional regulation decide what may be kept, shared and with whom.
        </p>
        <p class="mt-4 text-sm text-gray-500">This kiosk gives general information only, never a diagnosis. Clinics, hospitals, professionals and families managing health records should use ClinüxFlow.</p>
        <a :href="CLINUX_URL" target="_blank" rel="noopener" class="btn-primary mt-7 h-11 gap-2 px-5">Visit ClinüxFlow <ExternalLink class="size-4" aria-hidden="true" /></a>
      </div>
      <div>
        <ul class="grid gap-4 sm:grid-cols-2">
          <li v-for="s in CLINUX_SAFEGUARDS" :key="s.title" class="card p-5">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-ink"><ShieldCheck class="size-4 text-brand" aria-hidden="true" /> {{ s.title }}</h3>
            <p class="mt-1.5 text-sm leading-relaxed text-gray-600">{{ s.body }}</p>
          </li>
        </ul>
        <p class="mt-4 text-xs text-gray-500">ClinüxFlow is not affiliated with or endorsed by the National Health Authority.</p>
      </div>
    </div>
  </PageSection>

  <!-- For business, for home: a banner; the details open in a dialog -->
  <TwoSides />

  <!-- How it's kept safe -->
  <PageSection id="privacy" color="dark" title="Private by design" subtitle="The same rules behind every kiosk, every service and every answer.">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="p in PRINCIPLES" :key="p.title" class="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <Lock class="size-5 text-white/60" aria-hidden="true" />
        <h3 class="mt-4 text-base font-semibold text-white">{{ p.title }}</h3>
        <p class="mt-2 text-sm leading-relaxed text-white/70">{{ p.body }}</p>
      </div>
    </div>
  </PageSection>

  <!-- Get in touch (as ClinüxFlow's page ends) -->
  <PageSection id="contact" size="normal">
    <div class="card"><ContactPanel /></div>
  </PageSection>
</template>
