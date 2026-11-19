// Organisation templates (ORG-2): a starting point by the type of business, family or community.
// Choosing one creates its organisation document (units, their roles and who reports to whom) and
// its starter services, as drafts, in one step. Everything can be changed afterwards.
//
// Starter services are ordinary nested services (nested.ts). Each business and community template
// has one that goes to `manager-of-requester` (ORG-3), so an approval reaches the requester's own
// manager. Household templates have no reporting lines (ORG-8).
import { dump } from "js-yaml";
import { MANAGER_OF_REQUESTER } from "./roles.js";
import type { OrganisationType } from "./organisation.js";

export type TemplateEdition = "business" | "family" | "community";

export type OrganisationTemplate = {
  id: string;
  edition: TemplateEdition;
  title: string;
  summary: string;
  /** The organisation document, as YAML. */
  organisation: string;
  /** Starter services, as YAML (nested services). */
  services: string[];
};

type R = { id: string; label: string };
type U = { id: string; title: string; lead?: string; reports_to?: string; roles: R[]; services?: string[] };
type Q = { id: string; type: string; label: string; required?: boolean; options?: { value: string; label: string }[] };

const r = (id: string, label: string): R => ({ id, label });
const yes = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** A request someone makes and someone else decides on: the shape of most starter services. */
function requestService(o: {
  id: string;
  title: string;
  summary: string;
  icon: string;
  roles: R[];
  journey: { id: string; title: string; summary: string; initiate?: string[]; ask: string; questions: Q[]; decider: string; decision: string; agreed: string; declined: string };
}): string {
  const j = o.journey;
  return dump(
    {
      kind: "service",
      id: o.id,
      title: o.title,
      summary: o.summary,
      icon: o.icon,
      roles: o.roles,
      journeys: [
        {
          id: j.id,
          title: j.title,
          summary: j.summary,
          icon: o.icon,
          roles: { initiate: j.initiate ?? ["visitor"] },
          screens: [
            { id: "details", title: j.ask, questions: j.questions },
            {
              id: "decision",
              title: j.decision,
              role: j.decider,
              questions: [
                { id: "answer", type: "select", label: j.decision, required: true, options: yes },
                { id: "note", type: "textarea", label: "A note for them" },
              ],
            },
            { id: "route", decide: [{ if: "answers.decision.answer == 'yes'", to: "agreed" }, { to: "declined" }] },
            { id: "agreed", result: { title: j.agreed, text: "{{answers.decision.note}}", outcome: "agreed" } },
            { id: "declined", result: { title: j.declined, text: "{{answers.decision.note}}", outcome: "declined" } },
          ],
        },
      ],
    },
    { lineWidth: 120, noRefs: true },
  );
}

/** Time off, approved by the requester's own manager (ORG-3): every business template has it. */
const timeOff = (prefix: string, staff: R[]) =>
  requestService({
    id: `${prefix}-time-off`,
    title: "Time off",
    summary: "Ask for time off. It goes to your own manager.",
    icon: "calendar",
    roles: staff,
    journey: {
      id: `${prefix}-time-off-ask`,
      title: "Ask for time off",
      summary: "Say which days. Your manager says yes or no.",
      initiate: staff.map((s) => s.id),
      ask: "Which days?",
      questions: [
        { id: "from", type: "date", label: "From", required: true },
        { id: "to", type: "date", label: "To", required: true },
        { id: "reason", type: "textarea", label: "Anything your manager should know" },
      ],
      decider: MANAGER_OF_REQUESTER,
      decision: "Approve the time off?",
      agreed: "Time off approved",
      declined: "Time off not approved",
    },
  });

function org(id: string, title: string, type: OrganisationType, template: string, units: U[]): string {
  return dump(
    { kind: "organisation", id, title, type, template, sites: [{ id: "main", title: type === "household" ? "Home" : "Main site" }], units: units.map((u) => ({ ...u, sites: ["main"] })) },
    { lineWidth: 120, noRefs: true },
  );
}

/** Everyone who has a manager: the roles of units that report to another. */
const staffOf = (units: U[]) => units.filter((u) => u.reports_to).flatMap((u) => u.roles);

function business(id: string, title: string, summary: string, units: U[], starter: string): OrganisationTemplate {
  return { id, edition: "business", title, summary, organisation: org(id, title, "business", id, units), services: [starter, timeOff(id, staffOf(units))] };
}
function community(id: string, title: string, summary: string, units: U[], starter: string): OrganisationTemplate {
  return { id, edition: "community", title, summary, organisation: org(id, title, "community", id, units), services: [starter] };
}
function family(id: string, title: string, summary: string, units: U[], starter: string): OrganisationTemplate {
  return { id, edition: "family", title, summary, organisation: org(id, title, "household", id, units), services: [starter] };
}

// ---- Business --------------------------------------------------------------------------------------

const hardware: U[] = [
  { id: "office", title: "Owner", lead: "owner", roles: [r("owner", "Owner")] },
  { id: "counter", title: "Counter", reports_to: "office", lead: "counter-head", roles: [r("counter-head", "Counter head"), r("cashier", "Cashier")], services: ["hardware-store-orders"] },
  { id: "store-room", title: "Store room", reports_to: "office", lead: "store-keeper", roles: [r("store-keeper", "Store keeper"), r("helper", "Helper")] },
];
const salon: U[] = [
  { id: "office", title: "Owner", lead: "owner", roles: [r("owner", "Owner")] },
  { id: "front-desk", title: "Front desk", reports_to: "office", lead: "receptionist", roles: [r("receptionist", "Receptionist")], services: ["salon-appointments"] },
  { id: "stylists", title: "Stylists", reports_to: "office", lead: "senior-stylist", roles: [r("senior-stylist", "Senior stylist"), r("stylist", "Stylist")] },
];
const tuition: U[] = [
  { id: "office", title: "Director", lead: "director", roles: [r("director", "Director")] },
  { id: "admin-office", title: "Office", reports_to: "office", lead: "office-manager", roles: [r("office-manager", "Office manager"), r("office-staff", "Office staff")], services: ["tuition-centre-admissions"] },
  { id: "teaching", title: "Teaching", reports_to: "office", lead: "head-teacher", roles: [r("head-teacher", "Head teacher"), r("teacher", "Teacher")] },
];
const kitchen: U[] = [
  { id: "office", title: "Owner", lead: "owner", roles: [r("owner", "Owner")] },
  { id: "kitchen", title: "Kitchen", reports_to: "office", lead: "head-cook", roles: [r("head-cook", "Head cook"), r("cook", "Cook")], services: ["home-kitchen-orders"] },
  { id: "delivery", title: "Delivery", reports_to: "office", lead: "delivery-lead", roles: [r("delivery-lead", "Delivery lead"), r("delivery-person", "Delivery person")] },
];
const attendance: U[] = [
  { id: "office", title: "Manager", lead: "manager", roles: [r("manager", "Manager")], services: ["attendance-corrections"] },
  { id: "team", title: "Team", reports_to: "office", lead: "supervisor", roles: [r("supervisor", "Supervisor"), r("staff", "Staff")] },
];

// ---- Community -------------------------------------------------------------------------------------

const committee = (lead: string, leadLabel: string, more: R[] = []): U => ({ id: "committee", title: "Committee", lead, roles: [r(lead, leadLabel), ...more] });
const apartment: U[] = [
  committee("president", "President", [r("secretary", "Secretary"), r("treasurer", "Treasurer")]),
  { id: "maintenance", title: "Maintenance", reports_to: "committee", lead: "facility-manager", roles: [r("facility-manager", "Facility manager"), r("technician", "Technician")], services: ["apartment-association-complaints"] },
  { id: "security", title: "Security", reports_to: "committee", lead: "security-head", roles: [r("security-head", "Security head"), r("guard", "Guard")] },
];
const society: U[] = [
  committee("chairperson", "Chairperson", [r("secretary", "Secretary"), r("treasurer", "Treasurer")]),
  { id: "upkeep", title: "Upkeep", reports_to: "committee", lead: "estate-manager", roles: [r("estate-manager", "Estate manager"), r("caretaker", "Caretaker")], services: ["housing-society-hall"] },
];
const temple: U[] = [
  committee("president", "President", [r("secretary", "Secretary"), r("treasurer", "Treasurer")]),
  { id: "volunteers", title: "Volunteers", reports_to: "committee", lead: "volunteer-lead", roles: [r("volunteer-lead", "Volunteer lead"), r("volunteer", "Volunteer")], services: ["temple-committee-bookings"] },
];
const club: U[] = [
  committee("president", "President", [r("secretary", "Secretary")]),
  { id: "events", title: "Events", reports_to: "committee", lead: "events-lead", roles: [r("events-lead", "Events lead"), r("event-helper", "Event helper")], services: ["club-events"] },
];
const shg: U[] = [{ id: "group", title: "Group", lead: "group-leader", roles: [r("group-leader", "Group leader"), r("group-treasurer", "Treasurer"), r("group-member", "Member")], services: ["self-help-group-agenda"] }];
const parents: U[] = [
  { id: "committee", title: "Committee", lead: "coordinator", roles: [r("coordinator", "Coordinator")] },
  { id: "classes", title: "Class representatives", reports_to: "committee", lead: "lead-rep", roles: [r("lead-rep", "Lead representative"), r("class-rep", "Class representative")], services: ["parents-group-volunteers"] },
];

// ---- Family ----------------------------------------------------------------------------------------

const home: U[] = [{ id: "home", title: "Home", roles: [r("grown-up", "Grown-up"), r("child", "Child")], services: ["our-home-chores"] }];
const joint: U[] = [
  { id: "elders", title: "Elders", roles: [r("elder", "Elder")] },
  { id: "parents", title: "Parents", roles: [r("grown-up", "Grown-up")], services: ["joint-family-events"] },
  { id: "children", title: "Children", roles: [r("child", "Child")] },
];
const elder: U[] = [
  { id: "home", title: "Home", roles: [r("elder", "Elder")] },
  { id: "carers", title: "Carers and relatives", roles: [r("carer", "Carer"), r("relative", "Relative")], services: ["elder-alone-check-in"] },
];
const flat: U[] = [{ id: "flat", title: "The flat", roles: [r("flat-rep", "Flat representative"), r("flatmate", "Flatmate")], services: ["students-flat-expenses"] }];

/** Every template, by edition. */
export const ORGANISATION_TEMPLATES: readonly OrganisationTemplate[] = [
  business(
    "hardware-store",
    "Hardware store",
    "Owner, counter and store room. Customers order at the counter.",
    hardware,
    requestService({
      id: "hardware-store-orders",
      title: "Orders",
      summary: "Order an item; the counter confirms it.",
      icon: "clipboard-list",
      roles: [r("counter-head", "Counter head")],
      journey: {
        id: "hardware-store-order",
        title: "Order an item",
        summary: "Say what you need; the counter tells you if it can be had.",
        ask: "What do you need?",
        questions: [
          { id: "item", type: "text", label: "Item", required: true },
          { id: "quantity", type: "number", label: "How many" },
          { id: "phone", type: "text", label: "Phone, to tell you when it is ready" },
        ],
        decider: "counter-head",
        decision: "Can we supply it?",
        agreed: "Your order is accepted",
        declined: "We can't supply it",
      },
    }),
  ),
  business(
    "salon",
    "Salon",
    "Owner, front desk and stylists. Customers ask for an appointment.",
    salon,
    requestService({
      id: "salon-appointments",
      title: "Appointments",
      summary: "Ask for an appointment; the front desk confirms it.",
      icon: "calendar",
      roles: [r("receptionist", "Receptionist")],
      journey: {
        id: "salon-appointment",
        title: "Ask for an appointment",
        summary: "Choose a day; the front desk confirms the time.",
        ask: "When would you like to come?",
        questions: [
          { id: "service", type: "text", label: "What would you like done", required: true },
          { id: "day", type: "date", label: "Day", required: true },
          { id: "phone", type: "text", label: "Phone" },
        ],
        decider: "receptionist",
        decision: "Can we take it?",
        agreed: "Your appointment is booked",
        declined: "That time isn't free",
      },
    }),
  ),
  business(
    "tuition-centre",
    "Tuition centre",
    "Director, office and teachers. Parents make admission enquiries.",
    tuition,
    requestService({
      id: "tuition-centre-admissions",
      title: "Admissions",
      summary: "Ask about a place; the office replies.",
      icon: "book-open",
      roles: [r("office-manager", "Office manager")],
      journey: {
        id: "tuition-centre-enquiry",
        title: "Ask about a place",
        summary: "Say which class and subject; the office says if there is a place.",
        ask: "Which class and subject?",
        questions: [
          { id: "student", type: "text", label: "Student's first name", required: true },
          { id: "class", type: "text", label: "Class", required: true },
          { id: "subject", type: "text", label: "Subject" },
          { id: "phone", type: "text", label: "Parent's phone" },
        ],
        decider: "office-manager",
        decision: "Is there a place?",
        agreed: "There is a place",
        declined: "No place just now",
      },
    }),
  ),
  business(
    "home-kitchen",
    "Home kitchen",
    "Owner, kitchen and delivery. Customers order food.",
    kitchen,
    requestService({
      id: "home-kitchen-orders",
      title: "Food orders",
      summary: "Order food; the kitchen confirms it.",
      icon: "clipboard-list",
      roles: [r("head-cook", "Head cook")],
      journey: {
        id: "home-kitchen-order",
        title: "Order food",
        summary: "Say what and when; the kitchen confirms.",
        ask: "What would you like?",
        questions: [
          { id: "dishes", type: "textarea", label: "Dishes and how many", required: true },
          { id: "day", type: "date", label: "For which day", required: true },
          { id: "phone", type: "text", label: "Phone" },
        ],
        decider: "head-cook",
        decision: "Can we make it?",
        agreed: "Your order is confirmed",
        declined: "We can't make it that day",
      },
    }),
  ),
  business(
    "attendance",
    "Attendance",
    "A manager and a team. Staff correct a missed check-in.",
    attendance,
    requestService({
      id: "attendance-corrections",
      title: "Attendance corrections",
      summary: "Correct a missed check-in; your own manager approves it.",
      icon: "clipboard-list",
      roles: [r("supervisor", "Supervisor"), r("staff", "Staff")],
      journey: {
        id: "attendance-correction",
        title: "Correct a missed check-in",
        summary: "Say which day and when you came; your manager approves.",
        initiate: ["supervisor", "staff"],
        ask: "Which day?",
        questions: [
          { id: "day", type: "date", label: "Day", required: true },
          { id: "came", type: "text", label: "When you came and left", required: true },
        ],
        decider: MANAGER_OF_REQUESTER,
        decision: "Approve the correction?",
        agreed: "Correction approved",
        declined: "Correction not approved",
      },
    }),
  ),
  family(
    "our-home",
    "Our home",
    "Grown-ups and children under one roof.",
    home,
    requestService({
      id: "our-home-chores",
      title: "Chores",
      summary: "Say a chore is done; a grown-up checks it.",
      icon: "check",
      roles: [r("grown-up", "Grown-up"), r("child", "Child")],
      journey: {
        id: "our-home-chore-done",
        title: "A chore is done",
        summary: "Say which chore; a grown-up checks it.",
        ask: "Which chore?",
        questions: [{ id: "chore", type: "text", label: "Chore", required: true }],
        decider: "grown-up",
        decision: "Is it done?",
        agreed: "Well done",
        declined: "Not quite yet",
      },
    }),
  ),
  family(
    "joint-family",
    "Joint family",
    "Elders, parents and children in one family.",
    joint,
    requestService({
      id: "joint-family-events",
      title: "Family events",
      summary: "Suggest a family event; the grown-ups agree a date.",
      icon: "calendar",
      roles: [r("grown-up", "Grown-up")],
      journey: {
        id: "joint-family-event",
        title: "Suggest a family event",
        summary: "Say what and when; the grown-ups agree.",
        ask: "What would you like to plan?",
        questions: [
          { id: "event", type: "text", label: "Event", required: true },
          { id: "day", type: "date", label: "Day" },
        ],
        decider: "grown-up",
        decision: "Shall we do it?",
        agreed: "It's planned",
        declined: "Another time",
      },
    }),
  ),
  family(
    "elder-alone",
    "Elder living alone",
    "An elder at home, with carers and relatives nearby.",
    elder,
    requestService({
      id: "elder-alone-check-in",
      title: "Daily check-in",
      summary: "Say how the day is going; a carer sees it.",
      icon: "user-round",
      roles: [r("carer", "Carer")],
      journey: {
        id: "elder-alone-day",
        title: "How is today?",
        summary: "A short daily check-in a carer reads.",
        ask: "How is today?",
        questions: [
          { id: "feeling", type: "select", label: "How are you", required: true, options: [{ value: "good", label: "Good" }, { value: "fine", label: "Fine" }, { value: "help", label: "I need help" }] },
          { id: "note", type: "textarea", label: "Anything else" },
        ],
        decider: "carer",
        decision: "Seen it?",
        agreed: "Your carer has seen it",
        declined: "Your carer will call",
      },
    }),
  ),
  family(
    "students-flat",
    "Students sharing a flat",
    "Flatmates sharing costs.",
    flat,
    requestService({
      id: "students-flat-expenses",
      title: "Shared expenses",
      summary: "Add a shared expense; the flat representative agrees it.",
      icon: "file-text",
      roles: [r("flat-rep", "Flat representative")],
      journey: {
        id: "students-flat-expense",
        title: "Add a shared expense",
        summary: "Say what it was and how much.",
        ask: "What was it?",
        questions: [
          { id: "what", type: "text", label: "What", required: true },
          { id: "amount", type: "number", label: "Amount", required: true },
        ],
        decider: "flat-rep",
        decision: "Share it?",
        agreed: "Added to the shared list",
        declined: "Not shared",
      },
    }),
  ),
  community(
    "apartment-association",
    "Apartment association",
    "Committee, maintenance and security. Residents raise complaints.",
    apartment,
    requestService({
      id: "apartment-association-complaints",
      title: "Complaints",
      summary: "Raise a complaint; maintenance takes it up.",
      icon: "wrench",
      roles: [r("facility-manager", "Facility manager")],
      journey: {
        id: "apartment-association-complaint",
        title: "Raise a complaint",
        summary: "Say what and where; maintenance replies.",
        ask: "What is the problem?",
        questions: [
          { id: "problem", type: "textarea", label: "Problem", required: true },
          { id: "flat", type: "text", label: "Flat number" },
        ],
        decider: "facility-manager",
        decision: "Will we fix it?",
        agreed: "It will be fixed",
        declined: "It can't be fixed by us",
      },
    }),
  ),
  community(
    "housing-society",
    "Housing society",
    "Committee and upkeep. Members book the hall.",
    society,
    requestService({
      id: "housing-society-hall",
      title: "Hall booking",
      summary: "Book the hall; the secretary approves it.",
      icon: "calendar",
      roles: [r("secretary", "Secretary")],
      journey: {
        id: "housing-society-hall-booking",
        title: "Book the hall",
        summary: "Choose a day; the secretary approves.",
        ask: "When do you need the hall?",
        questions: [
          { id: "day", type: "date", label: "Day", required: true },
          { id: "purpose", type: "text", label: "What for", required: true },
        ],
        decider: "secretary",
        decision: "Approve the booking?",
        agreed: "The hall is booked",
        declined: "The hall isn't free",
      },
    }),
  ),
  community(
    "temple-committee",
    "Temple or church committee",
    "Committee and volunteers. Devotees book a service.",
    temple,
    requestService({
      id: "temple-committee-bookings",
      title: "Bookings",
      summary: "Book a service or a pooja; the volunteers confirm it.",
      icon: "calendar",
      roles: [r("volunteer-lead", "Volunteer lead")],
      journey: {
        id: "temple-committee-booking",
        title: "Book a service",
        summary: "Choose a day; the volunteers confirm.",
        ask: "What and when?",
        questions: [
          { id: "what", type: "text", label: "What", required: true },
          { id: "day", type: "date", label: "Day", required: true },
        ],
        decider: "volunteer-lead",
        decision: "Confirm the booking?",
        agreed: "Booked",
        declined: "That day isn't free",
      },
    }),
  ),
  community(
    "club",
    "Club",
    "Committee and an events team. Members sign up for events.",
    club,
    requestService({
      id: "club-events",
      title: "Events",
      summary: "Sign up for an event; the events team confirms your place.",
      icon: "calendar",
      roles: [r("events-lead", "Events lead")],
      journey: {
        id: "club-event-sign-up",
        title: "Sign up for an event",
        summary: "Say which event; the events team confirms.",
        ask: "Which event?",
        questions: [{ id: "event", type: "text", label: "Event", required: true }],
        decider: "events-lead",
        decision: "Is there a place?",
        agreed: "You have a place",
        declined: "It is full",
      },
    }),
  ),
  community(
    "self-help-group",
    "Self-help group",
    "A leader, a treasurer and members. Members add items to the meeting.",
    shg,
    requestService({
      id: "self-help-group-agenda",
      title: "Meeting agenda",
      summary: "Add an item for the next meeting; the leader agrees it.",
      icon: "clipboard-list",
      roles: [r("group-leader", "Group leader")],
      journey: {
        id: "self-help-group-item",
        title: "Add an item for the meeting",
        summary: "Say what to discuss.",
        ask: "What should we discuss?",
        questions: [{ id: "item", type: "textarea", label: "Item", required: true }],
        decider: "group-leader",
        decision: "Add it to the agenda?",
        agreed: "On the agenda",
        declined: "Not this time",
      },
    }),
  ),
  community(
    "parents-group",
    "Parents' group",
    "A coordinator and class representatives. Parents volunteer.",
    parents,
    requestService({
      id: "parents-group-volunteers",
      title: "Volunteering",
      summary: "Offer to help; a class representative replies.",
      icon: "user-round",
      roles: [r("class-rep", "Class representative")],
      journey: {
        id: "parents-group-volunteer",
        title: "Offer to help",
        summary: "Say how you can help.",
        ask: "How can you help?",
        questions: [
          { id: "help", type: "textarea", label: "How you can help", required: true },
          { id: "class", type: "text", label: "Your child's class" },
        ],
        decider: "class-rep",
        decision: "Thank them and confirm?",
        agreed: "Thank you: you're on the list",
        declined: "Not needed just now",
      },
    }),
  ),
];

/** The templates for an edition (the combined site offers every one). */
export const templatesFor = (edition?: TemplateEdition | null): OrganisationTemplate[] => ORGANISATION_TEMPLATES.filter((t) => !edition || t.edition === edition);
