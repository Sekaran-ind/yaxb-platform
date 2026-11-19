<script setup lang="ts">
// Anjal Family's home page (SUR-2): fun, warmth and love. A sunrise of peach, coral and butter,
// hearts and stars that drift (still for people who prefer reduced motion), sticker cards that tilt,
// and the family's own story: everyone asks in their own language, a child asks and a parent
// decides, birthdays come up by themselves, and everything stays at home. The colours are the
// page's own (--fam-*), with warm dark variants for the Night and High contrast themes.
import { Baby, CalendarHeart, Heart, HeartHandshake, House, Languages, Lock, MessageCircleHeart, NotebookPen, ShieldCheck, Sparkles, Star, Sun, UsersRound } from "@lucide/vue";
import IdeasSlides from "@/components/home/IdeasSlides.vue";
import ContactPanel from "@/components/site/ContactPanel.vue";
import { SITE_WIDTH } from "@/lib/site-width";

/** What a family does with it: sticker cards, each its own colour and tilt. */
const JOYS = [
  { icon: Languages, title: "Everyone asks their way", body: "Paati asks in Tamil, the children in English, Appa in Hindi. Every answer names where it came from.", tone: "peach", tilt: "-1.5deg" },
  { icon: NotebookPen, title: "One family notebook", body: "Manuals, warranty cards, school circulars and recipes, all in one place the whole family can ask about.", tone: "butter", tilt: "1deg" },
  { icon: MessageCircleHeart, title: "Ask, and a parent decides", body: "A child asks for something and says why; it goes only to their own parents, who say yes or not now.", tone: "rose", tilt: "-0.5deg" },
  { icon: CalendarHeart, title: "Birthdays come up by themselves", body: "Birthdays, anniversaries and bills due show up before the day, so nobody forgets.", tone: "mint", tilt: "1.5deg" },
  { icon: Baby, title: "Safe for little ones", body: "A child's profile, or the child safety lock with a parent's PIN: kind answers, no web, settings locked.", tone: "sky", tilt: "-1deg" },
  { icon: UsersRound, title: "A profile for everyone", body: "\"Who's using Anjal?\" Each person's notebook and conversations stay their own, sealed on the device.", tone: "lilac", tilt: "0.5deg" },
] as const;

const PROMISES = [
  { title: "Each person's own", body: "Every profile keeps its own notebook, Scheduler and conversations, sealed on the device." },
  { title: "Home stays home", body: "Notebooks and requests stay on your devices or your own box. The cloud is the last resort." },
  { title: "Facts, with love", body: "Answers say what your documents or trusted sources say, and name them. No advice of its own." },
  { title: "Gentle with children", body: "Parents see a child's requests, never their conversations. Worrying questions go to a trusted adult." },
];

/** Drifting hearts and stars in the hero: where, how big, and when each starts. */
const FLOATERS = [
  { icon: Heart, top: "12%", left: "6%", size: 28, delay: "0s", tone: "coral" },
  { icon: Star, top: "68%", left: "3%", size: 22, delay: "1.2s", tone: "sun" },
  { icon: Heart, top: "82%", left: "38%", size: 18, delay: "2.1s", tone: "rose" },
  { icon: Sparkles, top: "8%", left: "46%", size: 24, delay: "0.6s", tone: "sun" },
  { icon: Heart, top: "18%", left: "92%", size: 22, delay: "1.6s", tone: "rose" },
  { icon: Star, top: "88%", left: "90%", size: 26, delay: "0.3s", tone: "coral" },
] as const;
</script>

<template>
  <div class="fam">
    <!-- The hero: a warm sunrise, the family's promise, and a little scene from a family kiosk. -->
    <section id="about" class="fam-hero relative isolate scroll-mt-16 overflow-hidden">
      <span v-for="(f, i) in FLOATERS" :key="i" aria-hidden="true" :class="['fam-float', `fam-${f.tone}`]" :style="{ top: f.top, left: f.left, animationDelay: f.delay }">
        <component :is="f.icon" :size="f.size" fill="currentColor" stroke-width="1.5" />
      </span>
      <div :class="['mx-auto grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr]', SITE_WIDTH]">
        <div>
          <p class="fam-badge"><Sun class="size-4" aria-hidden="true" /> Anjal Family</p>
          <h1 class="mt-5 text-4xl font-bold tracking-[-0.035em] text-balance text-[var(--fam-ink)] md:text-6xl">
            Love lives here, and now it remembers
            <span class="fam-squiggle">everything</span>.
          </h1>
          <p class="mt-6 max-w-xl text-lg text-pretty text-[var(--fam-body)]">
            One warm corner for the whole family: ask in your own language, keep the manuals and the recipes, let the children ask and the parents say yes, and never forget a birthday again. Everything stays at home.
          </p>
          <div class="mt-9 flex flex-wrap items-center gap-3">
            <RouterLink to="/kiosk" class="fam-cta"><Heart class="size-4" fill="currentColor" aria-hidden="true" /> Try it with your family</RouterLink>
            <a href="#joys" class="fam-cta-soft">See what it does</a>
          </div>
        </div>

        <!-- A family kiosk, a moment in the day. Decorative: the words are above. -->
        <div class="relative mx-auto w-full max-w-md" aria-hidden="true">
          <div class="fam-scene">
            <p class="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-[var(--fam-muted)] uppercase"><House class="size-4" /> Our home · Sunday</p>
            <div class="mt-5 space-y-3">
              <div class="fam-bubble fam-bubble-left"><span class="fam-who fam-peach">Paati</span>பிரிட்ஜ் வாரண்டி எப்போது முடியும்?</div>
              <div class="fam-bubble fam-bubble-answer">
                March 2027, says the warranty card.
                <span class="fam-chip">Warranty card · LG fridge</span>
              </div>
              <div class="fam-bubble fam-bubble-left"><span class="fam-who fam-sky">Kavin, 9</span>Can I have a new football? Mine is flat!</div>
              <div class="fam-bubble fam-bubble-yes"><Heart class="size-4 shrink-0" fill="currentColor" /> Amma said yes: "On Saturday!"</div>
              <div class="fam-bubble fam-bubble-date"><CalendarHeart class="size-4 shrink-0" /> Thatha's birthday is on Friday</div>
            </div>
          </div>
          <span class="fam-sticker fam-sticker-a"><HeartHandshake class="size-5" /> made with love</span>
        </div>
      </div>
      <svg class="fam-wave" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 C 240 90, 480 0, 720 40 S 1200 90, 1440 30 L 1440 80 L 0 80 Z" /></svg>
    </section>

    <!-- What a family does with it: sticker cards. -->
    <section id="joys" class="fam-band py-16 md:py-24">
      <div :class="['mx-auto', SITE_WIDTH]">
        <header class="mx-auto mb-12 max-w-2xl text-center">
          <h2 class="text-3xl font-bold tracking-[-0.03em] text-[var(--fam-ink)] md:text-4xl">Little things that make home feel like home</h2>
          <p class="mt-3 text-lg text-[var(--fam-body)]">Everything here works on the kiosk in your living room, and on everyone's phone.</p>
        </header>
        <ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="j in JOYS" :key="j.title" :class="['fam-card', `fam-tone-${j.tone}`]" :style="{ '--tilt': j.tilt }">
            <span class="fam-blob"><component :is="j.icon" class="size-6" aria-hidden="true" /></span>
            <h3 class="mt-4 text-lg font-bold text-[var(--fam-ink)]">{{ j.title }}</h3>
            <p class="mt-2 text-[15px] leading-relaxed text-[var(--fam-body)]">{{ j.body }}</p>
          </li>
        </ul>
      </div>
    </section>

    <!-- Ideas for the family notebook. -->
    <section id="ideas" class="fam-ideas py-16 md:py-24">
      <div :class="['mx-auto', SITE_WIDTH]">
        <header class="mx-auto mb-10 max-w-2xl text-center">
          <h2 class="text-3xl font-bold tracking-[-0.03em] text-[var(--fam-ink)] md:text-4xl">Start with your home</h2>
          <p class="mt-3 text-lg text-[var(--fam-body)]">What to keep in the family notebook, and what the kiosk does with it.</p>
        </header>
        <IdeasSlides only="family" />
      </div>
    </section>

    <!-- Children. -->
    <section id="children" class="fam-band py-16 md:py-20">
      <div class="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 text-center">
        <span class="fam-blob fam-tone-sky"><Baby class="size-7" aria-hidden="true" /></span>
        <h2 class="text-3xl font-bold tracking-[-0.03em] text-balance text-[var(--fam-ink)]">Little ones are welcome too</h2>
        <p class="text-lg text-pretty text-[var(--fam-body)]">
          Give a child their own profile, or turn on the child safety lock with a parent's PIN. Answers stay simple and kind, the web stays off, and anything worrying goes to a trusted grown-up.
        </p>
        <RouterLink to="/kiosk" class="fam-cta mt-2"><Sparkles class="size-4" aria-hidden="true" /> Try the kiosk</RouterLink>
      </div>
    </section>

    <!-- Promises. -->
    <section id="privacy" class="fam-promise py-16 md:py-24">
      <div :class="['mx-auto', SITE_WIDTH]">
        <header class="mx-auto mb-12 max-w-2xl text-center">
          <h2 class="text-3xl font-bold tracking-[-0.03em] text-[var(--fam-ink)] md:text-4xl">Our promise to your family</h2>
          <p class="mt-3 text-lg text-[var(--fam-body)]">Love means keeping what's yours, yours.</p>
        </header>
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div v-for="p in PROMISES" :key="p.title" class="fam-promise-card">
            <span class="fam-lock"><Lock class="size-4" aria-hidden="true" /><Heart class="fam-lock-heart" fill="currentColor" aria-hidden="true" /></span>
            <h3 class="mt-4 text-base font-bold text-[var(--fam-ink)]">{{ p.title }}</h3>
            <p class="mt-2 text-sm leading-relaxed text-[var(--fam-body)]">{{ p.body }}</p>
          </div>
        </div>
        <p class="mt-8 flex items-center justify-center gap-2 text-sm text-[var(--fam-muted)]"><ShieldCheck class="size-4" aria-hidden="true" /> No advertising, no tracking, ever.</p>
      </div>
    </section>

    <section id="contact" class="fam-band py-12">
      <div class="mx-auto max-w-3xl px-4"><div class="card"><ContactPanel /></div></div>
    </section>
  </div>
</template>

<style>
/* Anjal Family's own palette: a sunrise. Light by default; warm dark for Night and High contrast. */
.fam {
  --fam-bg: #fff8f1;
  --fam-band: #fff1e6;
  --fam-ink: #3b1f14;
  --fam-body: #5b3a2c;
  --fam-muted: #8a5f4b;
  --fam-coral: #f0645a;
  --fam-coral-ink: #ffffff;
  --fam-sun: #f5b72a;
  --fam-rose: #ec6f9b;
  --fam-card: #ffffff;
  --fam-ring: #f6d9c6;
  --fam-peach: #ffe1cf;
  --fam-butter: #fff0b8;
  --fam-rosebg: #ffdbe7;
  --fam-mint: #d5f3e4;
  --fam-sky: #d9ecff;
  --fam-lilac: #ebe0ff;
  background: var(--fam-bg);
  color: var(--fam-body);
}
:root[data-theme="night"] .fam,
:root[data-theme="contrast"] .fam {
  --fam-bg: #1f1412;
  --fam-band: #281a16;
  --fam-ink: #fff3ea;
  --fam-body: #f2d9cc;
  --fam-muted: #d4ab98;
  --fam-coral: #ff8a7a;
  --fam-coral-ink: #2a0e08;
  --fam-sun: #ffcc4d;
  --fam-rose: #ff94b8;
  --fam-card: #2f201b;
  --fam-ring: #5a3a2e;
  --fam-peach: #4a2a1f;
  --fam-butter: #4a3a14;
  --fam-rosebg: #4a2030;
  --fam-mint: #1d3d30;
  --fam-sky: #1d3047;
  --fam-lilac: #34284d;
}
.fam-hero {
  background:
    radial-gradient(60% 70% at 85% 20%, color-mix(in oklab, var(--fam-rose) 28%, transparent), transparent 70%),
    radial-gradient(55% 60% at 10% 90%, color-mix(in oklab, var(--fam-sun) 30%, transparent), transparent 70%),
    linear-gradient(180deg, var(--fam-band), var(--fam-bg));
}
.fam-wave {
  position: absolute;
  inset: auto 0 -1px 0;
  width: 100%;
  height: 48px;
  fill: var(--fam-band);
}
.fam-band {
  background: var(--fam-band);
}
.fam-ideas {
  background: var(--fam-bg);
}
.fam-promise {
  background: linear-gradient(180deg, var(--fam-band), var(--fam-bg));
}

.fam-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.35rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--fam-ink);
  background: color-mix(in oklab, var(--fam-sun) 35%, var(--fam-card));
  box-shadow: 0 2px 0 color-mix(in oklab, var(--fam-sun) 60%, transparent);
}
.fam-squiggle {
  position: relative;
  white-space: nowrap;
  color: var(--fam-coral);
}
.fam-squiggle::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -0.12em;
  height: 0.28em;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 12'%3E%3Cpath d='M2 8 Q 15 0 30 7 T 60 7 T 90 7 T 118 6' fill='none' stroke='%23f5b72a' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E") center / 100% 100% no-repeat;
}

.fam-cta,
.fam-cta-soft {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.9rem;
  border-radius: 999px;
  padding: 0 1.4rem;
  font-weight: 700;
  font-size: 15px;
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.2s;
}
.fam-cta {
  color: var(--fam-coral-ink);
  background: var(--fam-coral);
  box-shadow: 0 6px 0 color-mix(in oklab, var(--fam-coral) 55%, #000);
}
.fam-cta:hover {
  transform: translateY(-2px) rotate(-1deg);
}
.fam-cta:active {
  transform: translateY(3px);
  box-shadow: 0 2px 0 color-mix(in oklab, var(--fam-coral) 55%, #000);
}
.fam-cta-soft {
  color: var(--fam-ink);
  background: var(--fam-card);
  box-shadow: inset 0 0 0 2px var(--fam-ring);
}
.fam-cta-soft:hover {
  transform: translateY(-2px) rotate(1deg);
}
.fam-cta:focus-visible,
.fam-cta-soft:focus-visible {
  outline: 3px solid var(--fam-sun);
  outline-offset: 3px;
}

.fam-float {
  position: absolute;
  z-index: -1;
  opacity: 0.75;
  animation: fam-drift 7s ease-in-out infinite;
}
.fam-coral {
  color: var(--fam-coral);
}
.fam-sun {
  color: var(--fam-sun);
}
.fam-rose {
  color: var(--fam-rose);
}
/* On a phone the words fill the width: the hearts and stars would sit on them. */
@media (max-width: 47.99rem) {
  .fam-float {
    display: none;
  }
}
@keyframes fam-drift {
  0%,
  100% {
    transform: translateY(0) rotate(-6deg);
  }
  50% {
    transform: translateY(-14px) rotate(6deg);
  }
}

.fam-scene {
  position: relative;
  border-radius: 2rem;
  padding: 1.6rem;
  background: var(--fam-card);
  box-shadow:
    0 0 0 3px var(--fam-ring),
    0 24px 60px -24px color-mix(in oklab, var(--fam-coral) 55%, transparent);
  transform: rotate(1.2deg);
}
.fam-bubble {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  width: fit-content;
  max-width: 92%;
  border-radius: 1.2rem;
  padding: 0.6rem 0.9rem;
  font-size: 14px;
  line-height: 1.45;
  color: var(--fam-ink);
}
.fam-bubble-left {
  background: var(--fam-band);
  border-bottom-left-radius: 0.35rem;
}
.fam-bubble-answer {
  margin-left: auto;
  background: var(--fam-butter);
  border-bottom-right-radius: 0.35rem;
}
.fam-bubble-yes {
  margin-left: auto;
  background: var(--fam-rosebg);
  font-weight: 700;
  color: var(--fam-ink);
}
.fam-bubble-yes svg {
  color: var(--fam-rose);
}
.fam-bubble-date {
  background: var(--fam-mint);
  font-weight: 600;
}
.fam-who {
  border-radius: 999px;
  padding: 0.05rem 0.55rem;
  font-size: 11px;
  font-weight: 700;
}
.fam-who.fam-peach {
  background: var(--fam-peach);
}
.fam-who.fam-sky {
  background: var(--fam-sky);
}
.fam-chip {
  width: 100%;
  font-size: 11px;
  color: var(--fam-muted);
}
.fam-sticker {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.45rem 0.9rem;
  font-size: 13px;
  font-weight: 700;
  color: var(--fam-coral-ink);
  background: var(--fam-coral);
  box-shadow: 0 4px 0 color-mix(in oklab, var(--fam-coral) 55%, #000);
}
.fam-sticker-a {
  left: -0.75rem;
  bottom: -1rem;
  transform: rotate(-6deg);
}

.fam-card {
  list-style: none;
  border-radius: 1.6rem;
  padding: 1.6rem;
  background: var(--fam-card);
  box-shadow:
    0 0 0 2px var(--fam-ring),
    0 10px 0 -2px var(--tone-bg);
  transform: rotate(var(--tilt, 0deg));
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fam-card:hover {
  transform: rotate(0deg) translateY(-4px) scale(1.02);
}
.fam-blob {
  display: inline-grid;
  place-items: center;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 42% 58% 55% 45% / 50% 45% 55% 50%;
  color: var(--fam-ink);
  background: var(--tone-bg, var(--fam-peach));
}
.fam-tone-peach {
  --tone-bg: var(--fam-peach);
}
.fam-tone-butter {
  --tone-bg: var(--fam-butter);
}
.fam-tone-rose {
  --tone-bg: var(--fam-rosebg);
}
.fam-tone-mint {
  --tone-bg: var(--fam-mint);
}
.fam-tone-sky {
  --tone-bg: var(--fam-sky);
}
.fam-tone-lilac {
  --tone-bg: var(--fam-lilac);
}

.fam-promise-card {
  border-radius: 1.4rem;
  padding: 1.5rem;
  background: var(--fam-card);
  box-shadow: 0 0 0 2px var(--fam-ring);
}
.fam-lock {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  color: var(--fam-ink);
  background: var(--fam-peach);
}
.fam-lock-heart {
  position: absolute;
  right: -4px;
  top: -4px;
  width: 14px;
  height: 14px;
  color: var(--fam-rose);
}

@media (prefers-reduced-motion: reduce) {
  .fam-float {
    animation: none;
  }
  .fam-card,
  .fam-cta,
  .fam-cta-soft {
    transition: none;
  }
  .fam-card:hover,
  .fam-cta:hover,
  .fam-cta-soft:hover {
    transform: rotate(var(--tilt, 0deg));
  }
}
</style>
