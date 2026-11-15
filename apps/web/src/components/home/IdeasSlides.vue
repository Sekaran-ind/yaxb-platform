<script setup lang="ts">
// Ideas for the Service Catalogue as a slideshow: one card per idea, each laid out like the motorbike
// showroom (what the notebook holds, the roles, and four steps from the notebook to the person who
// finishes the request). "Design this service" opens a new service with the AI designer's first
// message written for that idea (`/catalogue?service=new&idea=…`; nothing is sent until the person sends it).
// Previous/Next, the dots, the two group buttons, the arrow keys and a swipe move between ideas;
// #ideas-family and #ideas-business (the carousel's links) open that group's first idea.
// Every card sits in the same grid cell, so the section keeps the tallest card's height.
import { ArrowLeft, ArrowRight, Bike, Building2, GraduationCap, House, Scissors, UtensilsCrossed, Wrench, type LucideIcon } from "@lucide/vue";
import { offers } from "@/lib/surface";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { cn } from "@/lib/cn";

type Group = "family" | "business";
interface Idea {
  group: Group;
  icon: LucideIcon;
  title: string;
  summary: string;
  notebook: string[];
  roles: string[];
  steps: { title: string; body: string }[];
  /** The AI designer's first message. */
  idea: string;
}

const GROUPS: { id: Group; label: string }[] = [
  { id: "business", label: "Small business" },
  { id: "family", label: "Family and personal" },
];

const ALL_IDEAS: Idea[] = [
  {
    group: "business",
    icon: Bike,
    title: "Motorbike showroom",
    summary: "A notebook of every model, a conversation customers can have in their own language, and a sale the manager accepts with an agreed delivery date.",
    notebook: ["Every model's brochure and spec sheet", "The on-road price list", "Finance, insurance and exchange offers", "The service schedule and warranty terms"],
    roles: ["Customer", "Sales executive", "Showroom manager", "Service advisor"],
    steps: [
      { title: "Fill the notebook", body: "Staff add the brochures, the price list and the offers. The kiosk reads them; nothing is typed twice." },
      { title: "Customers ask", body: "\"Which models have a disc brake under ₹1 lakh?\" In Tamil, Hindi or English, by voice, with the brochure cited." },
      { title: "They start the sale", body: "The Booking journey asks for the model, colour, exchange and finance. Said aloud, it fills itself." },
      { title: "The manager accepts", body: "The showroom manager reviews the booking, agrees the on-road price and the delivery date, and accepts. The customer sees it under their reference." },
    ],
    idea:
      "Our two-wheeler showroom sells motorbikes and scooters. Customers ask about models, prices and offers. " +
      "Journey 1, Test ride: the customer gives their name, phone, the model and a preferred date and time; a sales executive confirms the slot. " +
      "Journey 2, Booking: the customer chooses the model, colour and variant, says whether they have a vehicle to exchange and whether they need finance; " +
      "the showroom manager reviews it, enters the agreed on-road price and delivery date, and accepts or declines with a note. " +
      "Journey 3, Service appointment: the customer gives the registration number, the kilometres and what needs attention; a service advisor confirms the date. " +
      "Roles: sales executive, showroom manager, service advisor. Key date: the first free service 30 days after delivery.",
  },
  {
    group: "business",
    icon: GraduationCap,
    title: "Tuition and coaching centre",
    summary: "Parents ask about batches and fees, apply for admission, and the centre head confirms the batch and the start date.",
    notebook: ["The syllabus for each class", "Batch timings and teachers", "The fee structure and payment dates", "Circulars and exam schedules"],
    roles: ["Parent", "Centre head", "Class teacher"],
    steps: [
      { title: "Fill the notebook", body: "Add the syllabus, the batch timetable and the fee structure, and update them each term." },
      { title: "Parents ask", body: "\"Is there a weekend batch for Class 10 maths?\" answered from the timetable, with it cited." },
      { title: "They apply", body: "The Admission journey asks for the student's class, subjects and preferred batch. A leave request works the same way." },
      { title: "The centre head confirms", body: "The centre head confirms the batch, the fee and the start date; the parent sees it under their reference." },
    ],
    idea:
      "Our tuition centre. Journey 1, Admission: a parent gives the student's name, class, subjects and preferred batch; the centre head confirms the batch, the fee and the start date. " +
      "Journey 2, Leave request: a parent gives the dates and the reason; the class teacher acknowledges it. Roles: centre head, class teacher. Key dates: term start and exam weeks.",
  },
  {
    group: "business",
    icon: UtensilsCrossed,
    title: "Home kitchen and caterer",
    summary: "Customers ask about dishes and allergens, then place a catering order the owner confirms with a price and an advance.",
    notebook: ["The menu and prices per plate", "Ingredients and allergens for each dish", "Minimum orders and delivery areas", "Packages for weddings and parties"],
    roles: ["Customer", "Owner"],
    steps: [
      { title: "Fill the notebook", body: "Add the menu, the price per plate and each dish's ingredients." },
      { title: "Customers ask", body: "\"Which dishes have no peanuts?\" answered from the ingredient list, never guessed." },
      { title: "They order", body: "The Catering order asks for the date, the place, the number of guests, the menu and any allergies." },
      { title: "The owner confirms", body: "The owner confirms the price, the advance and the delivery time, or declines with a note. The event date goes in the Scheduler." },
    ],
    idea:
      "Our home kitchen takes catering orders. Journey, Catering order: the customer gives the event date, the place, the number of guests, the menu choices and any allergies; " +
      "the owner confirms the price per plate, the advance and the delivery time, or declines with a note. Role: owner.",
  },
  {
    group: "business",
    icon: Scissors,
    title: "Salon and beauty parlour",
    summary: "Clients ask about services and prices, book a slot a stylist confirms, or ask the owner for a bridal quote.",
    notebook: ["Services, durations and prices", "Packages and seasonal offers", "The products used", "Stylists and their working days"],
    roles: ["Client", "Stylist", "Owner"],
    steps: [
      { title: "Fill the notebook", body: "Add the service list with durations and prices, and the current packages." },
      { title: "Clients ask", body: "\"How long does a hair spa take?\" with the price list cited." },
      { title: "They book", body: "The Appointment journey asks for the service, the date and a time. A bridal enquiry asks for the day and the party." },
      { title: "A stylist confirms", body: "A stylist confirms the slot; for a bridal package, the owner replies with a quote." },
    ],
    idea:
      "Our salon. Journey 1, Appointment: the client chooses the service, the date and a time; a stylist confirms the slot. " +
      "Journey 2, Bridal package: the client gives the wedding date, the number of people and the services wanted; the owner replies with a quote. Roles: stylist, owner.",
  },
  {
    group: "business",
    icon: Wrench,
    title: "Hardware and building supplies",
    summary: "Contractors check stock and sizes, send a list for a quote, and the owner approves the discount before delivery is set.",
    notebook: ["The product catalogue with sizes", "Brands and current rates", "Bulk discounts and credit terms", "Delivery areas and charges"],
    roles: ["Contractor", "Counter staff", "Owner", "Dispatcher"],
    steps: [
      { title: "Fill the notebook", body: "Add the catalogue and the rate list, and update the rates when they change." },
      { title: "Contractors ask", body: "\"Which PVC pipes do you stock in 1 inch?\" answered from the catalogue." },
      { title: "They ask for a quote", body: "The Quote request takes the items and quantities, typed or read out from a list." },
      { title: "Priced and approved", body: "Counter staff price it, the owner approves the discount, and the dispatcher sets the delivery date." },
    ],
    idea:
      "Our hardware store. Journey 1, Quote request: a contractor lists the items and quantities; counter staff add the prices, then the owner approves any discount. " +
      "Journey 2, Delivery: the customer gives the site address and the items; the dispatcher sets the delivery date. Roles: counter staff, owner, dispatcher.",
  },
  {
    group: "family",
    icon: House,
    title: "Our home",
    summary: "One notebook for the house. Everyone asks in their own language, children ask for things, parents decide, and repairs get booked.",
    notebook: ["Appliance manuals and warranty cards", "Insurance policies and renewal dates", "School circulars and timetables", "The family's recipes"],
    roles: ["Family member", "Parent", "Repairs"],
    steps: [
      { title: "Fill the notebook", body: "Add the manuals, warranty cards and school circulars as they arrive. Photos and PDFs both work." },
      { title: "Everyone asks", body: "\"When does the fridge warranty end?\" in Tamil, Hindi or English, with the warranty card cited." },
      { title: "Ask for something", body: "A child asks for something and says why. Anything broken is reported the same way." },
      { title: "A parent decides", body: "A parent approves or says no with a reason; whoever handles repairs books the electrician with a date." },
    ],
    idea:
      "A family kiosk at home. Journey 1, Ask for something: a child says what they want and why; a parent approves or says no with a reason. " +
      "Journey 2, Something needs fixing: anyone reports what is broken, where, and how urgent; the family member who handles repairs books the repair and gives a date. " +
      "Roles: parent, repairs. Key dates: birthdays, anniversaries and when bills are due.",
  },
  {
    group: "family",
    icon: Building2,
    title: "Apartment association",
    summary: "The bylaws and the vendor list answer residents' questions; complaints and hall bookings reach the committee.",
    notebook: ["The bylaws and maintenance rules", "Vendors and emergency contacts", "Meeting minutes and circulars", "Hall booking charges"],
    roles: ["Resident", "Secretary", "Committee member"],
    steps: [
      { title: "Fill the notebook", body: "The secretary adds the bylaws, the rules and the vendor list once; new circulars go in as they are issued." },
      { title: "Residents ask", body: "\"Can I park a second car?\" answered from the bylaws, with the clause cited." },
      { title: "Complain or book", body: "A resident gives the flat number and the problem, or the date and the number of guests for the hall." },
      { title: "The committee acts", body: "The secretary assigns a vendor and closes the complaint; a committee member approves the booking." },
    ],
    idea:
      "Our apartment association. Journey 1, Raise a complaint: a resident gives the flat number, the problem and how urgent it is; the secretary assigns a vendor and closes it when fixed. " +
      "Journey 2, Book the community hall: a resident chooses the date, the time and the number of guests; a committee member approves or declines. " +
      "Roles: secretary, committee member. Key dates: the annual general meeting.",
  },
];

/** `only`: one group's ideas, without the switch (a surface's own home page, SUR-2). */
const props = defineProps<{ only?: Group }>();
const IDEAS = props.only ? ALL_IDEAS.filter((x) => x.group === props.only) : ALL_IDEAS;
const current = ref(0);
const idea = computed(() => IDEAS[current.value]!);
const go = (i: number) => (current.value = (i + IDEAS.length) % IDEAS.length);
const firstOf = (g: Group) => IDEAS.findIndex((x) => x.group === g);
const designLink = (text: string) => ({ path: "/catalogue", query: { service: "new", idea: text } });

// The carousel's links: #ideas-family / #ideas-business open that group.
function fromHash() {
  const g = location.hash === "#ideas-family" ? "family" : location.hash === "#ideas-business" ? "business" : null;
  if (g) go(firstOf(g));
}
onMounted(() => {
  fromHash();
  window.addEventListener("hashchange", fromHash);
});
onUnmounted(() => window.removeEventListener("hashchange", fromHash));

let startX: number | null = null;
const touchStart = (e: TouchEvent) => (startX = e.touches[0]?.clientX ?? null);
function touchEnd(e: TouchEvent) {
  const end = e.changedTouches[0]?.clientX;
  if (startX !== null && end !== undefined && Math.abs(end - startX) > 50) go(current.value + (end < startX ? 1 : -1));
  startX = null;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowRight") go(current.value + 1);
  else if (e.key === "ArrowLeft") go(current.value - 1);
}
</script>

<template>
  <div aria-roledescription="carousel" aria-label="Ideas for your Service Catalogue" @touchstart.passive="touchStart" @touchend="touchEnd" @keydown="onKey">
    <span id="ideas-family" class="block scroll-mt-20" aria-hidden="true" />
    <span id="ideas-business" class="block scroll-mt-20" aria-hidden="true" />

    <!-- Controls: the two groups, then where you are and Previous/Next -->
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div v-if="!only" class="flex flex-wrap gap-1 rounded-full bg-mist p-1 ring-1 ring-gray-200/70" role="group" aria-label="Kind of idea">
        <button
          v-for="g in GROUPS"
          :key="g.id"
          type="button"
          :aria-pressed="idea.group === g.id"
          :class="cn('rounded-full px-4 py-1.5 text-sm transition', idea.group === g.id ? 'bg-surface font-medium text-ink shadow-sm ring-1 ring-gray-200/70' : 'text-gray-600 hover:text-ink')"
          @click="go(firstOf(g.id))"
        >
          {{ g.label }}
        </button>
      </div>
      <div class="flex items-center gap-2">
        <span class="mr-1 text-sm text-gray-500 tabular-nums" aria-live="polite">{{ current + 1 }} / {{ IDEAS.length }}</span>
        <button type="button" class="btn-light h-10 gap-1.5 px-4" aria-label="Previous idea" @click="go(current - 1)"><ArrowLeft class="size-4" aria-hidden="true" /> <span class="hidden sm:inline">Previous</span></button>
        <button type="button" class="btn-light h-10 gap-1.5 px-4" aria-label="Next idea" @click="go(current + 1)"><span class="hidden sm:inline">Next</span> <ArrowRight class="size-4" aria-hidden="true" /></button>
      </div>
    </div>

    <div class="grid">
      <article
        v-for="(i, n) in IDEAS"
        :key="i.title"
        role="group"
        aria-roledescription="slide"
        :aria-label="`${n + 1} of ${IDEAS.length}: ${i.title}`"
        :inert="n !== current"
        :class="cn('card col-start-1 row-start-1 overflow-hidden transition duration-300', n === current ? 'visible opacity-100' : 'invisible opacity-0')"
      >
        <div class="grid h-full lg:grid-cols-[1fr_1.35fr]">
          <div class="flex flex-col border-b border-gray-200/70 bg-mist/60 p-7 lg:border-r lg:border-b-0">
            <p class="eyebrow">{{ i.group === "family" ? "Family and personal" : "Small business" }}</p>
            <h3 class="mt-2 flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-ink"><component :is="i.icon" class="size-6 shrink-0" aria-hidden="true" /> {{ i.title }}</h3>
            <p class="mt-3 text-sm leading-relaxed text-gray-600">{{ i.summary }}</p>
            <h4 class="mt-6 text-xs font-semibold tracking-wide text-gray-500 uppercase">The notebook holds</h4>
            <ul class="mt-2 space-y-1.5 text-sm text-body">
              <li v-for="x in i.notebook" :key="x" class="flex gap-2"><span class="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />{{ x }}</li>
            </ul>
            <h4 class="mt-6 text-xs font-semibold tracking-wide text-gray-500 uppercase">Roles</h4>
            <ul class="mt-2 flex flex-wrap gap-1.5">
              <li v-for="r in i.roles" :key="r" class="chip">{{ r }}</li>
            </ul>
            <div class="mt-auto pt-7">
              <RouterLink v-if="offers('catalogue')" :to="designLink(i.idea)" class="btn-primary h-11 px-5">Design this service</RouterLink>
              <RouterLink v-else to="/kiosk" class="btn-primary h-11 px-5">Try it in the kiosk</RouterLink>
            </div>
          </div>
          <ol class="grid gap-px bg-gray-200/70 sm:grid-cols-2">
            <li v-for="(s, k) in i.steps" :key="s.title" class="bg-surface p-6">
              <span class="grid size-8 place-items-center rounded-full bg-brand-dark text-sm font-semibold text-on-brand">{{ k + 1 }}</span>
              <h4 class="mt-4 text-base font-semibold text-ink">{{ s.title }}</h4>
              <p class="mt-1.5 text-sm leading-relaxed text-gray-600">{{ s.body }}</p>
            </li>
          </ol>
        </div>
      </article>
    </div>

    <div class="mt-5 flex justify-center gap-1.5">
      <button
        v-for="(i, n) in IDEAS"
        :key="i.title"
        type="button"
        :aria-label="`Show idea ${n + 1}: ${i.title}`"
        :aria-current="n === current ? 'true' : undefined"
        :class="cn('h-2 rounded-full transition-all', n === current ? 'w-7 bg-ink' : 'w-2 bg-gray-300 hover:bg-gray-400')"
        @click="go(n)"
      />
    </div>
  </div>
</template>
