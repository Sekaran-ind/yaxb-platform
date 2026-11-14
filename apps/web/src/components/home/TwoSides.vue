<script setup lang="ts">
// Anjal's two sides (the positioning): small businesses connect with their customers, design their
// services and are found through Anjal.ai, its directory; families stay connected in one shared
// context, in a protected space. The directory's business listings are not built yet (published
// services are listed in the Service Catalogue today), so the page says "Coming soon" for them.
// On the page it is a small banner; "Coming soon" opens the two sides in a dialog.
import { ArrowRight, Bike, GraduationCap, Lock, MapPin, Search, Store, Users, UtensilsCrossed, type LucideIcon } from "@lucide/vue";
import { ref } from "vue";
import BaseModal from "@/components/site/BaseModal.vue";
import PageSection from "@/components/site/PageSection.vue";

const open = ref(false);
/** A link inside the dialog (to the ideas, the catalogue or the kiosk) closes it first. */
const closeOnLink = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest("a")) open.value = false;
};

const BUSINESS_POINTS = [
  { title: "Connect with customers", body: "They ask about your products and prices in their own language, any time, and get your answers with your sources." },
  { title: "Design your services", body: "A booking, a quote, an order: describe it and the AI designer drafts it. Your team accepts each request with a date." },
  { title: "Be found on Anjal.ai", body: "Publish your services to the Anjal.ai directory, so new customers find you and start a request from any kiosk." },
];
const HOME_POINTS = [
  { title: "One shared context", body: "The manuals, circulars, recipes and dates the family needs, in one notebook everyone can ask in their own language." },
  { title: "A protected space", body: "Each person's profile is encrypted on the device, a shared kiosk locks behind a PIN, and nothing leaves home unless you choose." },
  { title: "Stay connected", body: "Birthdays and bills come up by themselves, and requests between family members go to the one who decides." },
];

/** An example of the directory (made-up businesses). */
const LISTINGS: { icon: LucideIcon; name: string; kind: string; area: string; services: string[] }[] = [
  { icon: Bike, name: "Velan Two Wheelers", kind: "Motorbike showroom", area: "BTM Layout", services: ["Test ride", "Booking", "Service"] },
  { icon: GraduationCap, name: "Bright Minds Tuition", kind: "Coaching centre", area: "Jayanagar", services: ["Admission", "Leave request"] },
  { icon: UtensilsCrossed, name: "Amma's Kitchen", kind: "Home caterer", area: "HSR Layout", services: ["Catering order"] },
];
</script>

<template>
  <PageSection id="for-you" size="normal">
    <div class="card flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:justify-between md:px-8">
      <div>
        <h2 class="text-xl font-semibold tracking-[-0.02em] text-ink md:text-2xl">For business, for home</h2>
        <p class="mt-1.5 text-pretty text-gray-600">Businesses meet their customers on Anjal.ai. Families stay close, in a space that is theirs.</p>
      </div>
      <button
        type="button"
        class="group inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[linear-gradient(100deg,#6a1bd1,#c026d3_55%,#f97316)] px-6 text-[15px] font-bold text-white shadow-[0_8px_24px_-8px_#c026d3] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c026d3]"
        @click="open = true"
      >
        Coming soon <ArrowRight class="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
      </button>
    </div>
  </PageSection>

  <BaseModal :open="open" title="For business, for home" @close="open = false">
    <div class="grid gap-4 p-4 md:grid-cols-2 md:p-5" @click="closeOnLink">
      <!-- Business -->
      <article class="flex flex-col rounded-2xl p-5 ring-1 ring-gray-200/70">
        <p class="eyebrow flex items-center gap-2"><Store class="size-4" aria-hidden="true" /> For small businesses</p>
        <h3 class="mt-3 text-2xl font-semibold tracking-tight text-balance text-ink">Promote your business by serving your customers.</h3>
        <ul class="mt-5 space-y-4">
          <li v-for="p in BUSINESS_POINTS" :key="p.title">
            <p class="font-medium text-ink">{{ p.title }}</p>
            <p class="mt-0.5 text-sm leading-relaxed text-gray-600">{{ p.body }}</p>
          </li>
        </ul>

        <!-- The directory, as an example -->
        <div class="mt-7 rounded-2xl bg-mist/70 p-4 ring-1 ring-gray-200/70" aria-label="An example of the Anjal.ai directory">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">The Anjal.ai directory</p>
            <span class="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200/70">Coming soon</span>
          </div>
          <div class="mt-3 flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-sm text-gray-500 ring-1 ring-gray-200/70" aria-hidden="true"><Search class="size-4" /> Find a business or a service near you</div>
          <ul class="mt-3 space-y-2">
            <li v-for="l in LISTINGS" :key="l.name" class="flex items-start gap-3 rounded-xl bg-surface p-3 ring-1 ring-gray-200/70">
              <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-mist"><component :is="l.icon" class="size-4 text-ink" aria-hidden="true" /></span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-ink">{{ l.name }}</p>
                <p class="flex items-center gap-1 text-xs text-gray-500">{{ l.kind }} · <MapPin class="size-3" aria-hidden="true" /> {{ l.area }}</p>
                <p class="mt-1.5 flex flex-wrap gap-1"><span v-for="s in l.services" :key="s" class="chip">{{ s }}</span></p>
              </div>
            </li>
          </ul>
          <p class="mt-3 text-xs text-gray-500">Example listings. Published services are in the Service Catalogue today.</p>
        </div>

        <div class="mt-auto flex flex-wrap gap-3 pt-7">
          <RouterLink :to="{ path: '/catalogue', query: { service: 'new' } }" class="btn-primary h-11 px-5">Design your first service</RouterLink>
          <a href="#ideas-business" class="btn-light h-11 px-5">Ideas for your business</a>
        </div>
      </article>

      <!-- Home -->
      <article class="flex flex-col rounded-2xl p-5 ring-1 ring-gray-200/70">
        <p class="eyebrow flex items-center gap-2"><Users class="size-4" aria-hidden="true" /> For home</p>
        <h3 class="mt-3 text-2xl font-semibold tracking-tight text-balance text-ink">Stay connected, in a space that's yours.</h3>
        <ul class="mt-5 space-y-4">
          <li v-for="p in HOME_POINTS" :key="p.title">
            <p class="font-medium text-ink">{{ p.title }}</p>
            <p class="mt-0.5 text-sm leading-relaxed text-gray-600">{{ p.body }}</p>
          </li>
        </ul>

        <!-- Who's using Anjal? (the profile picker), as a picture -->
        <div class="mt-7 rounded-2xl bg-mist/70 p-5 ring-1 ring-gray-200/70" aria-hidden="true">
          <p class="text-center text-sm font-medium text-ink">Who's using Anjal?</p>
          <div class="mt-4 flex justify-center gap-4">
            <div v-for="m in ['Amma', 'Appa', 'Kavya', 'Arun']" :key="m" class="flex flex-col items-center gap-1.5">
              <span class="grid size-12 place-items-center rounded-full bg-surface text-base font-semibold text-ink ring-1 ring-gray-200/70">{{ m[0] }}</span>
              <span class="text-xs text-gray-600">{{ m }}</span>
            </div>
          </div>
          <p class="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-500"><Lock class="size-3.5" /> Each profile is sealed with its own passphrase</p>
        </div>

        <div class="mt-auto flex flex-wrap gap-3 pt-7">
          <RouterLink :to="{ path: '/kiosk', query: { prefs: 'profile' } }" class="btn-primary h-11 px-5">Set up your family</RouterLink>
          <a href="#ideas-family" class="btn-light h-11 px-5">Ideas for families</a>
        </div>
      </article>
    </div>
  </BaseModal>
</template>
