<script setup lang="ts">
// The Yaxb.ai portal (SUR-7..9): the combined site's home page. It leads to the platforms Yaxb.ai
// provides, each on its own site: Anjal Family (personal and community), Anjal for Business (small
// businesses) and ClinüxFlow (enterprises in regulated care). "Which fits you?" highlights one; each
// card opens its platform. Below: the one core they share, what every platform does, and how data
// is kept. Every claim here is something the platforms actually do.
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  HeartHandshake,
  Languages,
  Lock,
  Mic,
  Quote,
  Route,
  ShieldCheck,
  Smartphone,
  Store,
  type LucideIcon,
} from "@lucide/vue";
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import BrandLogo from "@/components/site/BrandLogo.vue";
import ContactPanel from "@/components/site/ContactPanel.vue";
import PageSection from "@/components/site/PageSection.vue";
import { cn } from "@/lib/cn";
import { PLATFORM_URLS } from "@/lib/surface";

type PlatformId = keyof typeof PLATFORM_URLS;
interface Platform {
  id: PlatformId;
  icon: LucideIcon;
  /** Who it is for, as the chooser and the card's label say it. */
  audience: string;
  pick: string;
  name: string;
  tagline: string;
  points: string[];
  cta: string;
  /** The card's accent (a hue that reads in every theme). */
  accent: string;
}

const PLATFORMS: Platform[] = [
  {
    id: "family",
    icon: HeartHandshake,
    audience: "Personal & Community",
    pick: "Me, my family or community",
    name: "Anjal Family",
    tagline: "Stay connected, in a space that's yours.",
    points: [
      "One shared notebook of manuals, circulars and recipes that everyone can ask in their own language",
      "Birthdays, bills and key dates come up by themselves",
      "Profiles sealed on the device, and a PIN-protected child safety lock",
    ],
    cta: "Open Anjal Family",
    accent: "#f97316",
  },
  {
    id: "business",
    icon: Store,
    audience: "Small Business",
    pick: "My small business",
    name: "Anjal for Business",
    tagline: "Connect with your customers. Get found on Anjal.ai.",
    points: [
      "Describe a service and the AI designer drafts its journeys, screens and consent forms",
      "Join links for your team, and every request routed to the right person with a reference",
      "A kiosk front desk, and a dashboard per service with completion, waits and outcomes",
    ],
    cta: "Open Anjal for Business",
    accent: "#c026d3",
  },
  {
    id: "enterprise",
    icon: Building2,
    audience: "Enterprise",
    pick: "My clinic, hospital or enterprise",
    name: "ClinüxFlow",
    tagline: "Regulated care, built on open standards.",
    points: [
      "FHIR R4 records with SNOMED CT, LOINC and ICD-10, so they stay portable",
      "ABDM flows (HPR, HFR, ABHA, consent) running against the sandbox today",
      "Consent in plain words under India's DPDP Act, with data kept local first",
    ],
    cta: "Visit ClinüxFlow",
    accent: "#6a1bd1",
  },
];

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// "Which fits you?": one card at a time is highlighted; picking again clears it.
const picked = ref<PlatformId | null>(null);
const cards = ref<Record<string, HTMLElement | null>>({});
async function pick(id: PlatformId) {
  picked.value = picked.value === id ? null : id;
  if (!picked.value) return;
  await nextTick();
  // On a narrow screen the cards stack, so bring the chosen one into view.
  const el = cards.value[id];
  if (el && window.matchMedia("(max-width: 1023px)").matches) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
}

const SHARED: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Languages, title: "Your language", body: "Ask and hear answers in Indian and world languages; the kiosk translates on the device." },
  { icon: Quote, title: "Facts with sources", body: "Every answer says what a source says and names it. No opinions of its own." },
  { icon: Route, title: "Journeys, not forms", body: "Services run one screen at a time, fill themselves from what you say, and hand over between people." },
  { icon: Mic, title: "Speak or type", body: "Talk to the kiosk or type to it, on a screen at the door or on a phone." },
  { icon: Smartphone, title: "Models on the device", body: "Search, translation and form filling can run in the browser, without sending your words away." },
  { icon: ShieldCheck, title: "Consent first", body: "Each service carries a consent form in plain words, shown before anyone starts." },
];

const PRINCIPLES = [
  { title: "Facts, not opinions", body: "Answers say what a source says and name it. No advice of the kiosk's own." },
  { title: "Your devices first", body: "Notebooks, profiles and requests stay on your devices or your own box. The cloud is the last resort." },
  { title: "Untrusted text stays data", body: "Instructions hidden in a document or web page are never followed." },
  { title: "Keys stay on the server", body: "AI and search keys never reach a browser; staff keys are shown once and stored hashed." },
];

// Sections rise into view once (skipped when motion is reduced).
const root = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
onMounted(() => {
  const items = root.value?.querySelectorAll<HTMLElement>("[data-reveal]") ?? [];
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  items.forEach((el) => el.classList.add("portal-hidden"));
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.remove("portal-hidden");
        observer?.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  items.forEach((el) => observer!.observe(el));
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="root">
    <!-- Hero -->
    <section class="relative isolate overflow-hidden bg-canvas">
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 -z-10">
        <div class="portal-blob top-[-12rem] left-[-8rem] bg-[#6a1bd1]" />
        <div class="portal-blob top-[-6rem] right-[-10rem] bg-[#c026d3] [animation-delay:-6s]" />
        <div class="portal-blob bottom-[-14rem] left-[30%] bg-[#f97316] [animation-delay:-12s]" />
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--color-gray-300)_1px,transparent_0)] [background-size:28px_28px] opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      </div>

      <div class="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 md:px-6 md:pt-24 md:pb-28 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p class="inline-flex items-center gap-2 rounded-full bg-surface/70 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200 backdrop-blur">
            <BrandLogo class="size-4" /> Yaxb.ai · AI that serves
          </p>
          <h1 class="mt-6 text-4xl font-semibold tracking-[-0.04em] text-balance text-ink sm:text-5xl md:text-6xl">
            One intelligence.<br />
            <span class="portal-gradient-text">Three ways to serve.</span>
          </h1>
          <p class="mt-6 max-w-xl text-lg text-pretty text-gray-600">
            Kiosks that answer with facts and sources, in your own language, and run your services one screen at a time: for families and communities, small businesses, and enterprises in regulated care.
          </p>
          <div class="mt-9 flex flex-wrap gap-3">
            <a href="#platforms" class="btn-primary h-12 gap-2 px-6 text-[15px]">Find your platform <ArrowRight class="size-4" aria-hidden="true" /></a>
            <RouterLink to="/kiosk" class="btn-light h-12 px-6 text-[15px]">Try the kiosk</RouterLink>
          </div>
        </div>

        <!-- The three platforms, at a glance -->
        <ul class="relative mx-auto grid w-full max-w-md gap-4" aria-label="Platforms">
          <li v-for="(p, i) in PLATFORMS" :key="p.id" class="portal-float" :style="{ animationDelay: `${i * -2}s`, marginLeft: `${[0, 2.5, 1][i]}rem` }">
            <a
              :href="`#platform-${p.id}`"
              class="group flex items-center gap-4 rounded-2xl bg-surface/85 p-4 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.35)] ring-1 ring-gray-200/80 backdrop-blur transition hover:-translate-y-0.5 hover:ring-gray-300"
              @click="picked = p.id"
            >
              <span class="grid size-11 shrink-0 place-items-center rounded-xl text-white" :style="{ background: `linear-gradient(135deg, ${p.accent}, color-mix(in srgb, ${p.accent} 55%, #000))` }">
                <component :is="p.icon" class="size-5" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-medium tracking-wide text-gray-500 uppercase">{{ p.audience }}</span>
                <span class="block truncate font-semibold text-ink">{{ p.name }}</span>
              </span>
              <ArrowRight class="size-4 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden="true" />
            </a>
          </li>
        </ul>
      </div>
    </section>

    <!-- Choose a platform -->
    <PageSection id="platforms" color="light" title="Choose your platform" subtitle="Each platform has its own site, on the same engine. Tell us who it's for, or open the one you need.">
      <div data-reveal class="mx-auto -mt-4 mb-10 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Which fits you?">
        <span class="mr-1 text-sm font-medium text-gray-500">Which fits you?</span>
        <button
          v-for="p in PLATFORMS"
          :key="p.id"
          type="button"
          :aria-pressed="picked === p.id"
          :class="cn('inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ring-1 transition', picked === p.id ? 'bg-brand-dark text-on-brand ring-transparent' : 'bg-surface text-gray-700 ring-gray-200 hover:ring-gray-300')"
          @click="pick(p.id)"
        >
          <component :is="p.icon" class="size-4" aria-hidden="true" /> {{ p.pick }}
        </button>
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        <article
          v-for="(p, i) in PLATFORMS"
          :id="`platform-${p.id}`"
          :key="p.id"
          :ref="(el) => (cards[p.id] = el as HTMLElement | null)"
          data-reveal
          :style="{ '--accent': p.accent, transitionDelay: `${i * 80}ms` }"
          :class="
            cn(
              'portal-card group relative flex scroll-mt-24 flex-col overflow-hidden rounded-3xl bg-surface p-7 ring-1 ring-gray-200/80 transition duration-300',
              picked === p.id && 'portal-card-picked',
              picked && picked !== p.id && 'opacity-55',
            )
          "
        >
          <div aria-hidden="true" class="absolute inset-x-0 top-0 h-1.5" :style="{ background: `linear-gradient(90deg, ${p.accent}, color-mix(in srgb, ${p.accent} 40%, transparent))` }" />
          <div aria-hidden="true" class="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full opacity-0 blur-3xl transition duration-500 group-hover:opacity-25" :style="{ background: p.accent }" />

          <div class="flex items-center justify-between gap-3">
            <span class="grid size-12 place-items-center rounded-2xl text-white shadow-lg" :style="{ background: `linear-gradient(135deg, ${p.accent}, color-mix(in srgb, ${p.accent} 55%, #000))` }">
              <component :is="p.icon" class="size-6" aria-hidden="true" />
            </span>
            <span class="rounded-full bg-mist px-3 py-1 text-xs font-medium text-gray-600">{{ p.audience }}</span>
          </div>

          <h3 class="mt-6 text-2xl font-semibold tracking-[-0.03em] text-ink">{{ p.name }}</h3>
          <p class="mt-2 text-pretty text-gray-600">{{ p.tagline }}</p>

          <ul class="mt-6 flex-1 space-y-3">
            <li v-for="pt in p.points" :key="pt" class="flex gap-3 text-sm leading-relaxed text-gray-700">
              <span aria-hidden="true" class="mt-2 size-1.5 shrink-0 rounded-full" :style="{ background: p.accent }" />
              {{ pt }}
            </li>
          </ul>

          <a
            :href="PLATFORM_URLS[p.id]"
            rel="noopener"
            class="portal-cta mt-8 inline-flex h-12 items-center justify-between gap-2 rounded-2xl px-5 text-[15px] font-semibold text-white transition"
            :style="{ background: `linear-gradient(100deg, color-mix(in srgb, ${p.accent} 80%, #000), ${p.accent})` }"
          >
            {{ p.cta }}
            <ArrowUpRight class="size-5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
          </a>
          <p class="mt-3 text-center text-xs text-gray-500">{{ hostOf(PLATFORM_URLS[p.id]) }}</p>
        </article>
      </div>
      <p class="mt-8 text-center text-xs text-gray-500">The kiosks give general information only, never a diagnosis. ClinüxFlow is not affiliated with or endorsed by the National Health Authority.</p>
    </PageSection>

    <!-- One core -->
    <PageSection id="core">
      <div class="grid items-center gap-12 lg:grid-cols-[1fr_1.15fr]">
        <div data-reveal>
          <p class="eyebrow">How it fits together</p>
          <h2 class="mt-3 text-3xl font-semibold tracking-[-0.03em] text-balance text-ink md:text-4xl">One core, every platform.</h2>
          <p class="mt-4 text-pretty text-gray-600">
            Every Yaxb.ai platform runs on the same two open packages: the kiosk's agent, knowledge and languages, and the engine for services and journeys. What one platform learns, all of them get; each adds only what its people need.
          </p>
          <ul class="mt-7 space-y-3 text-sm text-gray-700">
            <li class="flex gap-3"><BookOpen class="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" /> The same answers with sources, and the same safety rules, everywhere.</li>
            <li class="flex gap-3"><Route class="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" /> A service designed once runs on any kiosk, on the web or on a phone.</li>
            <li class="flex gap-3"><Lock class="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" /> Each platform keeps its own data, in its own place.</li>
          </ul>
        </div>

        <div data-reveal class="rounded-3xl bg-mist/60 p-5 ring-1 ring-gray-200/70 sm:p-7" role="img" aria-label="Anjal Family, Anjal for Business and ClinüxFlow all run on yaxb-journeys and yaxb-core">
          <div class="grid grid-cols-3 gap-2 sm:gap-3">
            <div v-for="p in PLATFORMS" :key="p.id" class="rounded-2xl bg-surface p-3 text-center ring-1 ring-gray-200/80 sm:p-4">
              <span class="mx-auto grid size-9 place-items-center rounded-xl text-white" :style="{ background: p.accent }"><component :is="p.icon" class="size-4" aria-hidden="true" /></span>
              <p class="mt-2 text-[11px] font-medium tracking-wide text-gray-500 uppercase sm:text-xs">{{ p.audience }}</p>
              <p class="mt-0.5 text-xs font-semibold text-ink sm:text-sm">{{ p.name }}</p>
            </div>
          </div>
          <div aria-hidden="true" class="grid grid-cols-3 gap-3">
            <div v-for="p in PLATFORMS" :key="p.id" class="mx-auto h-8 w-px" :style="{ background: `linear-gradient(${p.accent}, transparent)` }" />
          </div>
          <div class="rounded-2xl bg-surface p-4 ring-1 ring-gray-200/80">
            <p class="font-mono text-xs text-gray-500">@sekaran-ind/yaxb-journeys</p>
            <p class="mt-1 text-sm font-semibold text-ink">Services, journeys, forms and consent</p>
          </div>
          <div class="mt-3 rounded-2xl p-4 text-white" style="background: linear-gradient(100deg, #6a1bd1, #c026d3 55%, #f97316)">
            <p class="font-mono text-xs text-white/75">@sekaran-ind/yaxb-core</p>
            <p class="mt-1 text-sm font-semibold">The kiosk's agent, knowledge, languages and privacy</p>
          </div>
        </div>
      </div>
    </PageSection>

    <!-- What every platform does -->
    <PageSection id="shared" color="light" title="What every platform does" subtitle="Built in once, on every Yaxb.ai platform.">
      <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="(s, i) in SHARED" :key="s.title" data-reveal :style="{ transitionDelay: `${(i % 3) * 70}ms` }" class="card group p-6 transition hover:-translate-y-0.5">
          <span class="grid size-10 place-items-center rounded-xl bg-mist text-brand transition group-hover:scale-105"><component :is="s.icon" class="size-5" aria-hidden="true" /></span>
          <h3 class="mt-4 font-semibold text-ink">{{ s.title }}</h3>
          <p class="mt-1.5 text-sm leading-relaxed text-gray-600">{{ s.body }}</p>
        </li>
      </ul>
    </PageSection>

    <!-- How it's kept safe -->
    <PageSection id="privacy" color="dark" title="Private by design" subtitle="The same rules behind every platform, every service and every answer.">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="p in PRINCIPLES" :key="p.title" data-reveal class="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <Lock class="size-5 text-white/60" aria-hidden="true" />
          <h3 class="mt-4 text-base font-semibold text-white">{{ p.title }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-white/70">{{ p.body }}</p>
        </div>
      </div>
    </PageSection>

    <PageSection id="contact" size="normal">
      <div class="card"><ContactPanel /></div>
    </PageSection>
  </div>
</template>

<style scoped>
.portal-blob {
  position: absolute;
  width: 34rem;
  height: 34rem;
  border-radius: 9999px;
  opacity: 0.16;
  filter: blur(90px);
  animation: portal-drift 18s ease-in-out infinite alternate;
}
.portal-gradient-text {
  /* Inline, so the gradient spans the words rather than the column. */
  display: inline;
  background: linear-gradient(100deg, #6a1bd1, #c026d3 55%, #f97316);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.portal-float {
  animation: portal-float 7s ease-in-out infinite;
}
.portal-card:hover {
  box-shadow: 0 30px 60px -36px color-mix(in srgb, var(--accent) 70%, transparent);
  transform: translateY(-4px);
}
.portal-card-picked {
  box-shadow:
    0 0 0 2px var(--accent),
    0 30px 60px -30px color-mix(in srgb, var(--accent) 80%, transparent);
  transform: translateY(-4px);
}
.portal-cta:hover {
  filter: brightness(1.08);
}
.portal-cta:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
[data-reveal] {
  transition:
    opacity 0.7s ease,
    transform 0.7s ease,
    box-shadow 0.3s ease;
}
.portal-hidden {
  opacity: 0;
  transform: translateY(18px);
}
@keyframes portal-drift {
  to {
    transform: translate(4rem, 3rem) scale(1.1);
  }
}
@keyframes portal-float {
  50% {
    transform: translateY(-8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .portal-blob,
  .portal-float {
    animation: none;
  }
}
</style>
