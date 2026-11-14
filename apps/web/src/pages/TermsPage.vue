<script setup lang="ts">
// Credits, terms and privacy (after ClinüxFlow's /legal): what Anjal uses, the terms of use, and the
// privacy notice. The facts follow docs/specs/09-privacy-storage-security.md; the shared names and
// addresses are in lib/legal.ts.
import { ArrowLeft, ExternalLink } from "@lucide/vue";
import { BRAND, CLINUX_URL, CONTACT_EMAIL, CREDITS, OPERATOR, UPDATED } from "@/lib/legal";

const SECTIONS = [
  { id: "credits", label: "Credits" },
  { id: "terms", label: "Terms" },
  { id: "privacy", label: "Privacy" },
];

const TERMS: { title: string; points: string[] }[] = [
  {
    title: `Who may use ${BRAND}`,
    points: [
      `${BRAND} is provided by ${OPERATOR.name} for anyone who meets one of its kiosks, at a counter or on their own device, and for the families, businesses and organisations that run one.`,
      "Staff (moderators, reviewers and administrators) sign in with a key of their own. Keep it to yourself: anything done with it is taken to be done by you, and the audit log records it. An administrator can revoke or rotate a key at any time.",
    ],
  },
  {
    title: "What the answers are",
    points: [
      "Answers state what the kiosk's sources say and name each source. The kiosk gives no opinions or recommendations of its own, and says so plainly when nothing covers a question.",
      "Answers are general information, not medical, legal or financial advice, and never a diagnosis or treatment. They can be wrong or incomplete: check anything that matters with the source or with a person.",
      "In an emergency, call your local emergency number (112 in India). The kiosk shows it and passes the question to a person.",
    ],
  },
  {
    title: "Services and requests",
    points: [
      "Services in the catalogue are designed by their owners and offered on kiosks only after a reviewer accepts them. The organisation that runs a service answers for what it asks and for completing your requests.",
      `Submit only information that is true and that you are entitled to share. What a request leads to (a booking, a delivery date, a price) is agreed between you and that organisation; ${BRAND} carries the request, not the agreement, and takes no payments.`,
    ],
  },
  {
    title: "What you add",
    points: [
      "Add only documents and websites you have the right to use. Instructions written inside them are read as data and never followed.",
      "Don't enter identity numbers, account numbers or health details into the kiosk. A form's password fields are never sent to an AI model and are masked wherever a request is kept.",
    ],
  },
  {
    title: "Designing services",
    points: [
      "Anyone may design a service in the Service Catalogue; a guest keeps up to 20, in their own browser. The AI designer drafts from your description: check its draft before you send it for review.",
      "The designer learns from reviewers' decisions on its drafts (what changed, never your description), so later drafts improve.",
    ],
  },
  {
    title: "Healthcare",
    points: [`${BRAND} is not a medical device. Clinics, hospitals, health professionals and families keeping health records should use ClinüxFlow, which is built for healthcare's standards and regulation.`],
  },
  {
    title: "Changes",
    points: [`These terms are version ${UPDATED}. When they change, this page says so. Questions: ${CONTACT_EMAIL}.`],
  },
];

const KEPT: { where: string; what: string }[] = [
  { where: "On your device", what: "Your settings, notebooks (documents, websites, memory), conversations (by default), the Scheduler, team chat history and requests kept on devices. A profile and its activity log are encrypted with your own passphrase (PBKDF2 and AES-GCM); nobody can recover them without it." },
  { where: "On your own box", what: "If you connect a local box (Preferences → Storage), the notebooks, conversations and request hand-overs you send it. The box's token stays in your browser." },
  { where: "Sent for one answer, not kept", what: "Your question and that turn's notebook text go to the AI provider chosen in Preferences, and to the web search service when a question isn't covered and web search is on. Our server reads them to answer and keeps none of it." },
  { where: "On our server (Cloudflare)", what: "Conversations only if you chose Server storage (kept 30 days); questions escalated to moderators; answer reviews; session feedback, without identifying you; services in the catalogue with their audit log; facts about services stored on the server (never answers); and a request on its way to someone offline, held in the relay for up to 48 hours and deleted once collected." },
  { where: "Never stored", what: "The server never logs what you ask, your notebook's text or the answers. AI and search keys stay in the server's secrets and never reach a browser." },
];
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 pt-10 pb-20 sm:px-6">
    <RouterLink to="/" class="btn-ghost -ml-3 gap-1.5 text-sm"><ArrowLeft class="size-4" aria-hidden="true" /> Back</RouterLink>
    <h1 class="mt-4 text-3xl font-semibold tracking-[-0.03em] text-ink md:text-4xl">Credits, terms and privacy</h1>
    <p class="mt-3 text-gray-600">Updated {{ UPDATED }}. Data fiduciary: {{ OPERATOR.name }}.</p>

    <nav class="sticky top-14 z-10 -mx-4 mt-6 flex gap-1 border-b border-gray-200/70 bg-canvas/90 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0" aria-label="On this page">
      <a v-for="s in SECTIONS" :key="s.id" :href="`#${s.id}`" class="rounded-full px-3 py-1.5 text-sm text-gray-600 hover:bg-mist hover:text-ink">{{ s.label }}</a>
    </nav>

    <!-- Credits -->
    <section id="credits" class="scroll-mt-28 pt-10">
      <h2 class="text-2xl font-semibold tracking-tight text-ink">Credits</h2>
      <p class="mt-2 text-gray-600">{{ CREDITS.intro }}</p>
      <div v-for="g in CREDITS.groups" :key="g.title" class="mt-8">
        <h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">{{ g.title }}</h3>
        <dl class="mt-3 divide-y divide-gray-200/70 rounded-2xl border border-gray-200/70 bg-surface">
          <div v-for="c in g.items" :key="c.name" class="p-4">
            <dt class="font-medium text-ink">
              <a v-if="c.url" :href="c.url" target="_blank" rel="noopener" class="inline-flex items-center gap-1 hover:underline">{{ c.name }} <ExternalLink class="size-3 text-gray-400" aria-hidden="true" /></a>
              <template v-else>{{ c.name }}</template>
            </dt>
            <dd class="mt-1 text-sm leading-relaxed text-gray-600">{{ c.detail }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- Terms -->
    <section id="terms" class="scroll-mt-28 pt-14">
      <h2 class="text-2xl font-semibold tracking-tight text-ink">Terms of use</h2>
      <p class="mt-3 rounded-2xl bg-mist px-4 py-3 text-body">For anyone using an {{ BRAND }} kiosk, and the people who run one. {{ BRAND }} gives information from sources and carries requests to people; it does not give advice or make decisions for you.</p>
      <div v-for="t in TERMS" :key="t.title" class="mt-8">
        <h3 class="text-lg font-semibold text-ink">{{ t.title }}</h3>
        <ul class="mt-2 list-disc space-y-2 pl-5 leading-relaxed text-body">
          <li v-for="p in t.points" :key="p">{{ p }}</li>
        </ul>
        <a v-if="t.title === 'Healthcare'" :href="CLINUX_URL" target="_blank" rel="noopener" class="mt-3 inline-flex items-center gap-1 text-sm font-medium text-ink underline">Visit ClinüxFlow <ExternalLink class="size-3.5" aria-hidden="true" /></a>
      </div>
    </section>

    <!-- Privacy -->
    <section id="privacy" class="scroll-mt-28 pt-14">
      <h2 class="text-2xl font-semibold tracking-tight text-ink">Privacy notice</h2>
      <p class="mt-3 rounded-2xl bg-mist px-4 py-3 text-body">What you say, your notebooks and your profile stay on your device unless a feature you chose needs otherwise, and the kiosk tells you where that happens.</p>

      <h3 class="mt-8 text-lg font-semibold text-ink">Purpose</h3>
      <p class="mt-2 leading-relaxed text-body">To answer your questions, run the services you start, carry your requests to the people who complete them, and let moderators check and improve answers. Nothing is used for advertising or sold.</p>

      <h3 class="mt-8 text-lg font-semibold text-ink">Where your data is</h3>
      <dl class="mt-3 space-y-4">
        <div v-for="k in KEPT" :key="k.where">
          <dt class="font-medium text-ink">{{ k.where }}</dt>
          <dd class="mt-1 leading-relaxed text-body">{{ k.what }}</dd>
        </div>
      </dl>

      <h3 class="mt-8 text-lg font-semibold text-ink">Speech, cookies and contact</h3>
      <ul class="mt-2 list-disc space-y-2 pl-5 leading-relaxed text-body">
        <li>Speaking to the kiosk uses your browser's or phone's speech recognition, which may send the audio to its maker. On-device search, summaries and translation never send your text anywhere.</li>
        <li>One anonymous session cookie, signed by our server, protects forms and limits abuse; staff have a sign-in cookie. There are no advertising or tracking cookies. Your preferences are kept in your browser.</li>
        <li>A message from the contact form goes to our helpdesk so we can reply to you.</li>
      </ul>

      <h3 class="mt-8 text-lg font-semibold text-ink">Your rights</h3>
      <p class="mt-2 leading-relaxed text-body">
        Under the Digital Personal Data Protection Act, 2023, you can ask for a summary of the personal data we hold about you, have it corrected or erased, nominate someone to act for you, and raise a grievance. What is on your device is yours to export or erase: Preferences → Profile has both, and clearing the browser's data removes the rest.
      </p>
      <p class="mt-3 leading-relaxed text-body">Write to <a :href="`mailto:${CONTACT_EMAIL}`" class="font-medium text-ink underline">{{ CONTACT_EMAIL }}</a>. If you are not satisfied with our response, you can complain to the Data Protection Board of India.</p>
      <p class="mt-8 border-t border-gray-200/70 pt-4 text-sm text-gray-500">Data fiduciary: {{ OPERATOR.name }}, {{ OPERATOR.registered }}. Requests and grievances: {{ CONTACT_EMAIL }}.</p>
    </section>
  </div>
</template>
