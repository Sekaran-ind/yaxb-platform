<script setup lang="ts">
// Anjal Community's home page (EDN-4): collaboration, respect and a pleasant calm. Sage, teal and
// sand; circles that overlap as people come together; steps joined by one line, because the
// committee and the residents do this together; and what the committee may and may not see, said
// plainly. The colours are the page's own (--com-*), with calm dark variants for Night and High
// contrast. Its words: residents and members, the committee, blocks, the hall, notices.
import { ArrowRightLeft, BookOpen, Building2, CheckCircle2, Handshake, HeartHandshake, Megaphone, Scale, ShieldCheck, UserPlus, UsersRound } from "@lucide/vue";
import IdeasSlides from "@/components/home/IdeasSlides.vue";
import ContactPanel from "@/components/site/ContactPanel.vue";
import { SITE_WIDTH } from "@/lib/site-width";

const STEPS = [
  { icon: BookOpen, title: "Share what you know", body: "The secretary adds the bylaws, rules, vendor list and circulars once. Every resident can ask about them, in their own language, with the clause cited." },
  { icon: UserPlus, title: "Bring the committee", body: "Join links for each role: secretary, treasurer, committee member. You accept who joins; each person gets their own key." },
  { icon: ArrowRightLeft, title: "Raise it, see it through", body: "A resident raises a complaint or books the hall; it reaches the right committee member with a reference, and everyone sees where it stands." },
  { icon: Megaphone, title: "Keep everyone in the loop", body: "Notices go into the shared notebook, so every resident can ask about them in Tamil, Hindi or English, on the kiosk or their phone." },
];

const VALUES = [
  { icon: Handshake, title: "Together", body: "Residents ask, the committee answers, and each request carries a reference both can follow. Nobody is left wondering." },
  { icon: Scale, title: "Fair to everyone", body: "Every service is checked for treating people differently by caste, religion or gender; one that does needs a lawful reason to be published." },
  { icon: ShieldCheck, title: "Respect for privacy", body: "The committee sees only what comes to it: complaints, bookings and dues. Never a resident's own notebook, conversations or family." },
  { icon: HeartHandshake, title: "Calm and courteous", body: "Answers state what the bylaws, minutes or notices say, and name them. No opinions, no blame." },
];
</script>

<template>
  <div class="com">
    <!-- The hero: a calm welcome, and a moment in a residents' association. -->
    <section id="about" class="com-hero relative isolate scroll-mt-16 overflow-hidden">
      <div :class="['mx-auto grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr]', SITE_WIDTH]">
        <div>
          <p class="com-badge"><UsersRound class="size-4" aria-hidden="true" /> Anjal Community</p>
          <h1 class="mt-5 text-4xl font-semibold tracking-[-0.03em] text-balance text-[var(--com-ink)] md:text-6xl">
            A community runs best <span class="com-underline">together</span>.
          </h1>
          <p class="mt-6 max-w-xl text-lg text-pretty text-[var(--com-body)]">
            For apartment associations, clubs, temple committees and parents' groups. Residents ask and are answered in their own language, complaints and bookings reach the right person, and everyone is treated with the same respect.
          </p>
          <div class="mt-9 flex flex-wrap items-center gap-3">
            <a href="#ideas" class="com-cta"><Handshake class="size-4" aria-hidden="true" /> Ideas for your community</a>
            <RouterLink to="/kiosk" class="com-cta-soft">Try the kiosk</RouterLink>
          </div>
        </div>

        <!-- Decorative: circles coming together, and a moment from a residents' kiosk. -->
        <div class="relative mx-auto w-full max-w-md" aria-hidden="true">
          <div class="com-circles">
            <span class="com-circle com-c1" />
            <span class="com-circle com-c2" />
            <span class="com-circle com-c3" />
          </div>
          <div class="com-scene">
            <p class="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-[var(--com-muted)] uppercase"><Building2 class="size-4" /> Lotus Apartments</p>
            <div class="mt-5 space-y-3">
              <div class="com-bubble com-bubble-ask"><span class="com-who">B-204</span>Can I park a second car in the visitors' bay?</div>
              <div class="com-bubble com-bubble-answer">
                Only between 10 pm and 7 am, for up to two nights a week.
                <span class="com-chip">Bylaws · clause 14.3</span>
              </div>
              <div class="com-request">
                <span class="flex items-center gap-2 font-semibold text-[var(--com-ink)]"><CheckCircle2 class="size-4 text-[var(--com-teal)]" /> Hall booking · Sun 6 Dec</span>
                <span class="text-[13px] text-[var(--com-body)]">Approved by the secretary · 40 guests</span>
                <span class="com-ref">R-7KQ3MD</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- How it runs: four steps on one line, done together. -->
    <section id="how" class="com-band py-16 md:py-24">
      <div :class="['mx-auto', SITE_WIDTH]">
        <header class="mx-auto mb-12 max-w-2xl text-center">
          <h2 class="text-3xl font-semibold tracking-[-0.03em] text-[var(--com-ink)] md:text-4xl">How your community runs on Anjal</h2>
          <p class="mt-3 text-lg text-[var(--com-body)]">Four steps, shared by the committee and the residents.</p>
        </header>
        <ol class="com-steps grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <li v-for="(s, i) in STEPS" :key="s.title" class="com-step">
            <span class="com-step-dot"><component :is="s.icon" class="size-5" aria-hidden="true" /></span>
            <p class="mt-4 text-xs font-semibold tracking-[0.14em] text-[var(--com-muted)] uppercase">Step {{ i + 1 }}</p>
            <h3 class="mt-1 text-lg font-semibold text-[var(--com-ink)]">{{ s.title }}</h3>
            <p class="mt-2 text-[15px] leading-relaxed text-[var(--com-body)]">{{ s.body }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- Ideas. -->
    <section id="ideas" class="com-plain py-16 md:py-24">
      <div :class="['mx-auto', SITE_WIDTH]">
        <header class="mx-auto mb-10 max-w-2xl text-center">
          <h2 class="text-3xl font-semibold tracking-[-0.03em] text-[var(--com-ink)] md:text-4xl">Ideas for your community</h2>
          <p class="mt-3 text-lg text-[var(--com-body)]">Pick one and the AI designer drafts its services for the committee to adjust. Publish them, and residents start them from any kiosk or phone.</p>
        </header>
        <IdeasSlides only="community" />
      </div>
    </section>

    <!-- What it stands for. -->
    <section id="privacy" class="com-values py-16 md:py-24">
      <div :class="['mx-auto', SITE_WIDTH]">
        <header class="mx-auto mb-12 max-w-2xl text-center">
          <h2 class="text-3xl font-semibold tracking-[-0.03em] text-[var(--com-ink)] md:text-4xl">Respect, built in</h2>
          <p class="mt-3 text-lg text-[var(--com-body)]">What the committee may see, what it never may, and how everyone is treated.</p>
        </header>
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div v-for="v in VALUES" :key="v.title" class="com-value">
            <span class="com-value-icon"><component :is="v.icon" class="size-5" aria-hidden="true" /></span>
            <h3 class="mt-4 text-base font-semibold text-[var(--com-ink)]">{{ v.title }}</h3>
            <p class="mt-2 text-sm leading-relaxed text-[var(--com-body)]">{{ v.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <section id="contact" class="com-band py-12">
      <div class="mx-auto max-w-3xl px-4"><div class="card"><ContactPanel /></div></div>
    </section>
  </div>
</template>

<style>
/* Anjal Community's own palette: sage, teal and sand. Calm dark variants for Night and High contrast. */
.com {
  --com-bg: #f7f5ef;
  --com-band: #eef3ee;
  --com-ink: #1d2e28;
  --com-body: #3e524a;
  --com-muted: #6b7f76;
  --com-teal: #0f8a7e;
  --com-teal-ink: #ffffff;
  --com-sage: #8fb8a2;
  --com-sky: #9cc3e0;
  --com-sand: #e9d8b4;
  --com-card: #ffffff;
  --com-ring: #d6e2da;
  --com-soft: #e3efe8;
  background: var(--com-bg);
  color: var(--com-body);
}
:root[data-theme="night"] .com,
:root[data-theme="contrast"] .com {
  --com-bg: #111a17;
  --com-band: #16221e;
  --com-ink: #ecf5f0;
  --com-body: #c7d9d0;
  --com-muted: #94ada2;
  --com-teal: #4fd1c0;
  --com-teal-ink: #062521;
  --com-sage: #4f7a65;
  --com-sky: #3e6582;
  --com-sand: #6e5d3b;
  --com-card: #1b2925;
  --com-ring: #2f4640;
  --com-soft: #20332d;
}

.com-hero {
  background:
    radial-gradient(55% 60% at 88% 18%, color-mix(in oklab, var(--com-sky) 30%, transparent), transparent 70%),
    radial-gradient(50% 55% at 8% 92%, color-mix(in oklab, var(--com-sand) 45%, transparent), transparent 70%),
    linear-gradient(180deg, var(--com-band), var(--com-bg));
}
.com-band {
  background: var(--com-band);
}
.com-plain {
  background: var(--com-bg);
}
.com-values {
  background: linear-gradient(180deg, var(--com-bg), var(--com-band));
}

.com-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.35rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--com-ink);
  background: var(--com-soft);
  box-shadow: inset 0 0 0 1px var(--com-ring);
}
.com-underline {
  color: var(--com-teal);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklab, var(--com-sage) 70%, transparent);
  text-decoration-thickness: 0.12em;
  text-underline-offset: 0.14em;
}

.com-cta,
.com-cta-soft {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.9rem;
  border-radius: 999px;
  padding: 0 1.4rem;
  font-weight: 600;
  font-size: 15px;
  transition:
    background 0.2s,
    box-shadow 0.2s,
    transform 0.2s;
}
.com-cta {
  color: var(--com-teal-ink);
  background: var(--com-teal);
  box-shadow: 0 10px 24px -12px color-mix(in oklab, var(--com-teal) 70%, transparent);
}
.com-cta:hover {
  transform: translateY(-1px);
  background: color-mix(in oklab, var(--com-teal) 88%, #000);
}
.com-cta-soft {
  color: var(--com-ink);
  background: var(--com-card);
  box-shadow: inset 0 0 0 1.5px var(--com-ring);
}
.com-cta-soft:hover {
  box-shadow: inset 0 0 0 1.5px var(--com-sage);
}
.com-cta:focus-visible,
.com-cta-soft:focus-visible {
  outline: 3px solid var(--com-sage);
  outline-offset: 3px;
}

/* Three circles drifting towards each other: people coming together. */
.com-circles {
  position: absolute;
  inset: -2.5rem -2rem auto auto;
  width: 13rem;
  height: 9rem;
  z-index: -1;
}
.com-circle {
  position: absolute;
  width: 7.5rem;
  height: 7.5rem;
  border-radius: 999px;
  mix-blend-mode: multiply;
  opacity: 0.55;
  animation: com-gather 9s ease-in-out infinite;
}
:root[data-theme="night"] .com-circle,
:root[data-theme="contrast"] .com-circle {
  mix-blend-mode: screen;
}
.com-c1 {
  left: 0;
  top: 0.5rem;
  background: var(--com-sage);
}
.com-c2 {
  left: 3.2rem;
  top: 0;
  background: var(--com-sky);
  animation-delay: -3s;
}
.com-c3 {
  left: 5.5rem;
  top: 1.2rem;
  background: var(--com-sand);
  animation-delay: -6s;
}
@keyframes com-gather {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(-0.6rem);
  }
}

.com-scene {
  border-radius: 1.75rem;
  padding: 1.6rem;
  background: var(--com-card);
  box-shadow:
    0 0 0 1px var(--com-ring),
    0 28px 60px -30px color-mix(in oklab, var(--com-teal) 45%, transparent);
}
.com-bubble {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  width: fit-content;
  max-width: 92%;
  border-radius: 1.1rem;
  padding: 0.6rem 0.9rem;
  font-size: 14px;
  line-height: 1.45;
  color: var(--com-ink);
}
.com-bubble-ask {
  background: var(--com-band);
  border-bottom-left-radius: 0.35rem;
}
.com-bubble-answer {
  margin-left: auto;
  background: var(--com-soft);
  border-bottom-right-radius: 0.35rem;
}
.com-who {
  border-radius: 999px;
  padding: 0.05rem 0.55rem;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in oklab, var(--com-sand) 60%, var(--com-card));
}
.com-chip {
  width: 100%;
  font-size: 11px;
  color: var(--com-muted);
}
.com-request {
  position: relative;
  display: grid;
  gap: 0.2rem;
  border-radius: 1.1rem;
  padding: 0.8rem 0.95rem;
  font-size: 14px;
  background: var(--com-card);
  box-shadow: inset 0 0 0 1px var(--com-ring);
}
.com-ref {
  position: absolute;
  right: 0.8rem;
  top: 0.75rem;
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--com-muted);
  background: var(--com-band);
}

/* Steps joined by one line: the committee and the residents, together. */
.com-steps {
  position: relative;
}
@media (min-width: 64rem) {
  .com-steps::before {
    content: "";
    position: absolute;
    /* From the first step's circle to the last one's (four columns, 1.5rem gaps). */
    left: 1.5rem;
    right: calc((100% - 4.5rem) / 4 - 1.5rem);
    top: 1.5rem;
    height: 2px;
    background: repeating-linear-gradient(90deg, var(--com-sage) 0 10px, transparent 10px 18px);
    z-index: 0;
  }
}
.com-step {
  position: relative;
  list-style: none;
  border-radius: 1.4rem;
  padding: 0 0.25rem;
}
.com-step-dot {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  color: var(--com-teal-ink);
  background: var(--com-teal);
  box-shadow: 0 0 0 6px var(--com-band);
}

.com-value {
  border-radius: 1.4rem;
  padding: 1.5rem;
  background: var(--com-card);
  box-shadow: 0 0 0 1px var(--com-ring);
}
.com-value-icon {
  display: inline-grid;
  place-items: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 0.9rem;
  color: var(--com-teal);
  background: var(--com-soft);
}

@media (prefers-reduced-motion: reduce) {
  .com-circle {
    animation: none;
  }
  .com-cta,
  .com-cta-soft {
    transition: none;
  }
  .com-cta:hover {
    transform: none;
  }
}
</style>
