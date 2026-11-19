<script setup lang="ts">
// The home page's first panel: a carousel of slides, each a short write-up with a picture of the
// kiosk on the right. Anjal itself, a family, a small business, a community, and the kiosk's key features
// (with "See all features" opening the details in a dialog).
// It moves on by itself only while nobody is pointing at it or focused in it, and never for people
// who prefer reduced motion; it can be paused, stepped with the arrows or the dots, and swiped.
// Every slide sits in the same grid cell, so the panel keeps the tallest slide's height.
import { ArrowLeft, ArrowRight, ArrowRightLeft, Baby, Bike, BookOpen, Building2, CalendarHeart, HardDrive, Languages, LayoutGrid, MessagesSquare, Pause, Play, ShieldCheck, Smartphone, Sparkles, UserRound, WifiOff, Workflow, type LucideIcon } from "@lucide/vue";
import { SURFACE } from "@/lib/surface";
import { computed, onMounted, onUnmounted, ref } from "vue";
import BaseModal from "@/components/site/BaseModal.vue";
import { cn } from "@/lib/cn";
import { BRAND } from "@/lib/legal";
import { SITE_WIDTH } from "@/lib/site-width";

const SLIDES = ["Anjal.ai", "Family and personal", "Small business", "What's in the kiosk", "Community"] as const;
/** The slides this surface shows (SUR-2, EDN-4): its own story, then what's in the kiosk. */
const SHOWN: number[] = SURFACE === "family" ? [1, 3] : SURFACE === "business" ? [2, 3] : SURFACE === "community" ? [4, 3] : [0, 1, 2, 4, 3];
const INTERVAL = 9000;

/** Each feature names the surfaces it belongs to (SUR-2); the combined site shows them all. */
const ALL_FEATURES: { icon: LucideIcon; title: string; short: string; body: string; surfaces: ("family" | "business" | "community")[] }[] = [
  { icon: MessagesSquare, title: "Ask Me", short: "Cited answers in 14 languages", body: "Ask by voice or text in 14 languages. Every answer names its source, says so when nothing covers the question, and passes emergencies straight to a person." , surfaces: ["family", "business", "community"] },
  { icon: BookOpen, title: "My notebook", short: "Your documents and websites", body: "Add documents, PDFs and whole websites. The kiosk answers from them, remembers what matters, and keeps them on your device." , surfaces: ["family", "business", "community"] },
  { icon: Workflow, title: "Quick tools and journeys", short: "Forms that fill from your words", body: "Guided services, one screen at a time. Say it in your own words and the form fills itself; you check it before it goes." , surfaces: ["family", "business", "community"] },
  { icon: ArrowRightLeft, title: "Requests between people", short: "Handed to the right person", body: "A customer starts, staff finish. Each request gets a reference and moves to the right person's device, with its status in the conversation." , surfaces: ["business", "community"] },
  { icon: Sparkles, title: "Service Catalogue and AI designer", short: "Services from a description", body: "Describe a service in plain words, in a conversation like Ask Me. The designer drafts its journeys, screens and roles; an ethics check flags anyone treated differently, and a reviewer publishes it for any kiosk." , surfaces: ["business", "community"] },
  { icon: ArrowRightLeft, title: "Requests at home", short: "A child asks, a parent decides", body: "From At home in Quick tools: a child asks for something, anyone reports a repair, or plans an outing. A child's request goes only to their own parents; repairs go to whoever handles them. It all stays on the family's device.", surfaces: ["family"] },
  { icon: CalendarHeart, title: "Scheduler", short: "Birthdays and key dates", body: "Birthdays, anniversaries, to-dos and every service's key dates in one place. \"Next Friday at 4\" is understood on the device." , surfaces: ["family", "business", "community"] },
  { icon: Baby, title: "Child safety lock", short: "Safe for children", body: "A parent turns it on with a PIN, or a profile is set as under 18. Answers are written for a child, nothing for adults, no web search, and worrying questions go to a trusted adult and the moderators. Settings and staff areas stay locked." , surfaces: ["family", "community"] },
  { icon: UserRound, title: "Profiles", short: "Private profiles", body: "\"Who's using Anjal?\" keeps each person's notebook and Scheduler apart, encrypted on the device.", surfaces: ["family", "community"] },
  { icon: UserRound, title: "The front desk", short: "A locked public kiosk", body: "Restricted Mode turns the kiosk into a front desk for chosen services, behind a staff PIN. Nothing about a visitor stays on it.", surfaces: ["business", "community"] },
  { icon: ShieldCheck, title: "Quality you can measure", short: "Moderated and measured", body: "Moderators check flagged answers and rate them. Each notebook gets an F1 score week by week, with the weakest answers listed first." , surfaces: ["business", "community"] },
];

const FEATURES = SURFACE === "all" ? ALL_FEATURES : ALL_FEATURES.filter((f) => (f.surfaces as string[]).includes(SURFACE));

const RUNS_ON: { icon: LucideIcon; label: string }[] = [
  { icon: LayoutGrid, label: "Full, Pod or Mini kiosk" },
  { icon: Smartphone, label: "Android and iOS app" },
  { icon: HardDrive, label: "Your own box on a Raspberry Pi" },
  { icon: WifiOff, label: "On-device models, offline" },
  { icon: Languages, label: "Voice in and out" },
];

const current = ref(0);
const paused = ref(false);
const hovering = ref(false);
const focused = ref(false);
const featuresOpen = ref(false);
const reduced = ref(false);
const moving = computed(() => !paused.value && !hovering.value && !focused.value && !featuresOpen.value && !reduced.value);

const go = (i: number) => (current.value = (i + SHOWN.length) % SHOWN.length);
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  reduced.value = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  timer = setInterval(() => {
    if (moving.value && !document.hidden) go(current.value + 1);
  }, INTERVAL);
});
onUnmounted(() => clearInterval(timer));

// Swipe on touch screens.
let startX: number | null = null;
const touchStart = (e: TouchEvent) => (startX = e.touches[0]?.clientX ?? null);
function touchEnd(e: TouchEvent) {
  const end = e.changedTouches[0]?.clientX;
  if (startX === null || end === undefined) return;
  const dx = end - startX;
  if (Math.abs(dx) > 50) go(current.value + (dx < 0 ? 1 : -1));
  startX = null;
}

const slideClass = (i: number) =>
  cn("col-start-1 row-start-1 grid items-center gap-12 transition duration-500 lg:grid-cols-[1.1fr_1fr]", SHOWN[current.value] === i ? "visible opacity-100" : "invisible opacity-0");
/** "2 of 4": a slide's place among the shown ones. */
const place = (i: number) => `${SHOWN.indexOf(i) + 1} of ${SHOWN.length}`;
</script>

<template>
  <section
    id="about"
    class="relative isolate overflow-hidden"
    aria-roledescription="carousel"
    aria-label="About Anjal"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
    @focusin="focused = true"
    @focusout="focused = false"
    @touchstart.passive="touchStart"
    @touchend="touchEnd"
  >
    <div aria-hidden="true" class="absolute inset-x-0 -top-40 -z-10 h-[36rem] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-brand)_18%,transparent),transparent_70%)]" />
    <div :class="cn('mx-auto pt-14 pb-10 md:pt-20', SITE_WIDTH)">
      <div class="grid" aria-live="off">
        <!-- 1. Anjal -->
        <div v-if="SHOWN.includes(0)" :class="slideClass(0)" role="group" aria-roledescription="slide" :aria-label="`${place(0)}: ${SLIDES[0]}`" :inert="SHOWN[current] !== 0">
          <div>
            <p class="eyebrow">{{ BRAND }} · for business and home</p>
            <h1 class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance text-ink md:text-6xl">Where businesses meet their customers, and families stay close.</h1>
            <p class="mt-6 max-w-xl text-lg text-pretty text-gray-600">Businesses design their services and are found on Anjal.ai; customers ask in their own language and every request reaches the right person. At home, the family shares one context in a space that stays private.</p>
            <div class="mt-9 flex flex-wrap items-center gap-3">
              <RouterLink to="/kiosk" class="btn-primary h-11 px-6">Try the kiosk</RouterLink>
              <RouterLink to="/catalogue" class="btn-light h-11 px-5">Design a service</RouterLink>
            </div>
          </div>
          <div class="console mx-auto w-full max-w-md lg:mr-0 px-7 py-9" aria-hidden="true">
            <div class="flex items-center justify-between">
              <p class="text-[10px] font-semibold tracking-[0.22em] text-white/50 uppercase">Anjal</p>
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

        <!-- 2. Family and personal -->
        <div v-if="SHOWN.includes(1)" :class="slideClass(1)" role="group" aria-roledescription="slide" :aria-label="`${place(1)}: ${SLIDES[1]}`" :inert="SHOWN[current] !== 1">
          <div>
            <p class="eyebrow">Family and personal</p>
            <component :is="SHOWN[0] === 1 ? 'h1' : 'h2'" class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance text-ink md:text-5xl">Stay connected, in a space that's yours.</component>
            <p class="mt-6 max-w-xl text-lg text-pretty text-gray-600">The family shares one context: the manuals, circulars, recipes and dates everyone needs, asked about in each person's own language. Profiles are encrypted, a shared kiosk can be locked, and nothing leaves your devices unless you choose.</p>
            <div class="mt-9 flex flex-wrap items-center gap-3">
              <a href="#ideas-family" class="btn-primary h-11 px-6">Ideas for families</a>
              <RouterLink to="/kiosk" class="btn-light h-11 px-5">Try the kiosk</RouterLink>
            </div>
          </div>
          <div class="console mx-auto w-full max-w-md lg:mr-0 px-6 py-7" aria-hidden="true">
            <p class="text-[10px] font-semibold tracking-[0.22em] text-white/50 uppercase">Anjal · at home</p>
            <p class="mt-6 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-white/10 px-4 py-2.5 text-[15px] text-white">When does the fridge warranty end?</p>
            <div class="mt-4 rounded-2xl bg-white/5 p-4 text-sm leading-relaxed text-white/80 ring-1 ring-white/10">
              On 12 March 2027, two years from the date of purchase.
              <span class="mt-3 flex gap-1.5"><span class="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">Fridge warranty card</span></span>
            </div>
            <div class="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <p class="flex items-center gap-2 text-xs font-semibold tracking-wide text-white/60 uppercase"><CalendarHeart class="size-3.5" /> Coming up</p>
              <ul class="mt-3 space-y-2 text-sm text-white/85">
                <li class="flex justify-between gap-3"><span>Amma's birthday</span><span class="text-white/55">Sat 21 Nov</span></li>
                <li class="flex justify-between gap-3"><span>School trip fee due</span><span class="text-white/55">Mon 23 Nov</span></li>
                <li class="flex justify-between gap-3"><span>Electricity bill</span><span class="text-white/55">Fri 27 Nov</span></li>
              </ul>
            </div>
          </div>
        </div>

        <!-- 3. Small business -->
        <div v-if="SHOWN.includes(2)" :class="slideClass(2)" role="group" aria-roledescription="slide" :aria-label="`${place(2)}: ${SLIDES[2]}`" :inert="SHOWN[current] !== 2">
          <div>
            <p class="eyebrow">Small business</p>
            <component :is="SHOWN[0] === 2 ? 'h1' : 'h2'" class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance text-ink md:text-5xl">Connect with your customers. Get found on Anjal.ai.</component>
            <p class="mt-6 max-w-xl text-lg text-pretty text-gray-600">Put your catalogue and prices in a notebook and design your services, from a booking to a quote. Customers ask in their own language, start a request, and your team accepts it with a date. Publish your services and new customers find you on Anjal.ai.</p>
            <div class="mt-9 flex flex-wrap items-center gap-3">
              <a
                href="#ideas"
                class="group inline-flex h-11 items-center gap-2 rounded-full bg-[linear-gradient(100deg,#6a1bd1,#c026d3_55%,#f97316)] px-6 text-[15px] font-bold text-white shadow-[0_8px_24px_-8px_#c026d3] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c026d3]"
              >
                <Sparkles class="size-4" aria-hidden="true" /> Ideas for your business
                <ArrowRight class="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
              <RouterLink to="/catalogue" class="btn-light h-11 px-5">Design a service</RouterLink>
            </div>
          </div>
          <div class="console mx-auto w-full max-w-md lg:mr-0 px-6 py-7" aria-hidden="true">
            <p class="text-[10px] font-semibold tracking-[0.22em] text-white/50 uppercase">Anjal · showroom</p>
            <p class="mt-6 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-white/10 px-4 py-2.5 text-[15px] text-white">Which models have a disc brake under ₹1 lakh?</p>
            <div class="mt-4 rounded-2xl bg-white/5 p-4 text-sm leading-relaxed text-white/80 ring-1 ring-white/10">
              Three, in the November price list: Aero 125, Breeze 110 Disc and Trail 150 (on-road).
              <span class="mt-3 flex flex-wrap gap-1.5"><span class="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">Price list · Nov 2026</span></span>
            </div>
            <div class="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <div class="flex items-center justify-between gap-3">
                <p class="flex items-center gap-2 text-sm font-medium text-white"><Bike class="size-4 text-white/70" /> Booking · Aero 125, red</p>
                <span class="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/70">REQ-4F2K</span>
              </div>
              <p class="mt-3 text-xs text-white/60">Accepted by the showroom manager · delivery Sat 28 Nov</p>
            </div>
          </div>
        </div>

        <!-- 5. Community (EDN-4) -->
        <div v-if="SHOWN.includes(4)" :class="slideClass(4)" role="group" aria-roledescription="slide" :aria-label="`${place(4)}: ${SLIDES[4]}`" :inert="SHOWN[current] !== 4">
          <div>
            <p class="eyebrow">Community</p>
            <component :is="SHOWN[0] === 4 ? 'h1' : 'h2'" class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance text-ink md:text-5xl">Your association, in every resident's language.</component>
            <p class="mt-6 max-w-xl text-lg text-pretty text-gray-600">For apartment associations, clubs and committees. The bylaws and notices answer residents' questions, with the clause cited. Residents raise complaints and book the hall; the committee answers each with a reference. The committee never sees anyone's own notebook or conversations.</p>
            <div class="mt-9 flex flex-wrap items-center gap-3">
              <a
                href="#ideas"
                class="group inline-flex h-11 items-center gap-2 rounded-full bg-[linear-gradient(100deg,#6a1bd1,#c026d3_55%,#f97316)] px-6 text-[15px] font-bold text-white shadow-[0_8px_24px_-8px_#c026d3] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c026d3]"
              >
                <Sparkles class="size-4" aria-hidden="true" /> Ideas for your community
                <ArrowRight class="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
              <RouterLink to="/kiosk" class="btn-light h-11 px-5">Try the kiosk</RouterLink>
            </div>
          </div>
          <div class="console mx-auto w-full max-w-md lg:mr-0 px-6 py-7" aria-hidden="true">
            <p class="text-[10px] font-semibold tracking-[0.22em] text-white/50 uppercase">Anjal · Lotus Apartments</p>
            <p class="mt-6 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-white/10 px-4 py-2.5 text-[15px] text-white">Can I park a second car in the visitors' bay?</p>
            <div class="mt-4 rounded-2xl bg-white/5 p-4 text-sm leading-relaxed text-white/80 ring-1 ring-white/10">
              Only between 10 pm and 7 am, and for no more than two nights a week.
              <span class="mt-3 flex flex-wrap gap-1.5"><span class="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">Bylaws · clause 14.3</span></span>
            </div>
            <div class="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <div class="flex items-center justify-between gap-3">
                <p class="flex items-center gap-2 text-sm font-medium text-white"><Building2 class="size-4 text-white/70" /> Hall booking · Sun 6 Dec</p>
                <span class="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/70">R-7KQ3MD</span>
              </div>
              <p class="mt-3 text-xs text-white/60">Approved by the secretary · 40 guests</p>
            </div>
          </div>
        </div>

        <!-- 4. What's in the kiosk -->
        <div v-if="SHOWN.includes(3)" :class="slideClass(3)" role="group" aria-roledescription="slide" :aria-label="`${place(3)}: ${SLIDES[3]}`" :inert="SHOWN[current] !== 3">
          <div>
            <p class="eyebrow">What's in the kiosk</p>
            <h2 class="mt-4 text-4xl font-semibold tracking-[-0.035em] text-balance text-ink md:text-5xl">Everything in one kiosk.</h2>
            <ul class="mt-6 grid max-w-xl gap-x-6 gap-y-2.5 sm:grid-cols-2">
              <li v-for="f in FEATURES" :key="f.title" class="flex items-center gap-2.5 text-[15px] text-body">
                <component :is="f.icon" class="size-4 shrink-0 text-gray-500" aria-hidden="true" /> {{ f.short }}
              </li>
            </ul>
            <div class="mt-9 flex flex-wrap items-center gap-3">
              <button type="button" class="btn-primary h-11 px-6" @click="featuresOpen = true">See all features</button>
              <RouterLink to="/kiosk" class="btn-light h-11 px-5">Try the kiosk</RouterLink>
            </div>
          </div>
          <div class="console mx-auto w-full max-w-md lg:mr-0 px-6 py-7" aria-hidden="true">
            <p class="text-[10px] font-semibold tracking-[0.22em] text-white/50 uppercase">Runs where you are</p>
            <ul class="mt-6 space-y-2.5">
              <li v-for="r in RUNS_ON" :key="r.label" class="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 text-sm text-white/85 ring-1 ring-white/10">
                <component :is="r.icon" class="size-4 text-white/60" /> {{ r.label }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div class="mt-10 flex items-center justify-center gap-2 lg:justify-start">
        <button type="button" class="grid size-9 place-items-center rounded-full ring-1 ring-gray-200 hover:bg-mist" aria-label="Previous slide" @click="go(current - 1)"><ArrowLeft class="size-4" /></button>
        <div class="flex items-center gap-1.5 px-1">
          <button
            v-for="(n, i) in SHOWN"
            :key="n"
            type="button"
            :aria-label="`Show slide ${i + 1}: ${SLIDES[n]}`"
            :aria-current="i === current ? 'true' : undefined"
            :class="cn('h-2 rounded-full transition-all', i === current ? 'w-7 bg-ink' : 'w-2 bg-gray-300 hover:bg-gray-400')"
            @click="go(i)"
          />
        </div>
        <button type="button" class="grid size-9 place-items-center rounded-full ring-1 ring-gray-200 hover:bg-mist" aria-label="Next slide" @click="go(current + 1)"><ArrowRight class="size-4" /></button>
        <button v-if="!reduced" type="button" class="ml-1 grid size-9 place-items-center rounded-full text-gray-500 hover:bg-mist hover:text-ink" :aria-label="paused ? 'Play the slides' : 'Pause the slides'" @click="paused = !paused">
          <Play v-if="paused" class="size-4" /><Pause v-else class="size-4" />
        </button>
      </div>
    </div>

    <BaseModal :open="featuresOpen" title="What's in the kiosk" @close="featuresOpen = false">
      <div class="grid gap-4 p-5 sm:grid-cols-2">
        <article v-for="f in FEATURES" :key="f.title" class="flex gap-4 rounded-2xl bg-mist/60 p-4 ring-1 ring-gray-200/70">
          <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-surface ring-1 ring-gray-200/70"><component :is="f.icon" class="size-5 text-ink" aria-hidden="true" /></span>
          <div>
            <h3 class="font-semibold text-ink">{{ f.title }}</h3>
            <p class="mt-1 text-sm leading-relaxed text-gray-600">{{ f.body }}</p>
          </div>
        </article>
      </div>
      <div class="border-t border-gray-200/70 px-5 py-4">
        <h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Runs where you are</h3>
        <ul class="mt-3 flex flex-wrap gap-2">
          <li v-for="r in RUNS_ON" :key="r.label" class="chip gap-1.5"><component :is="r.icon" class="size-3.5" aria-hidden="true" /> {{ r.label }}</li>
        </ul>
      </div>
    </BaseModal>
  </section>
</template>
