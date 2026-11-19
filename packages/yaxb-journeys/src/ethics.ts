// The Ethics Counsellor's check without a model (ETH-1): protected attributes in a journey's
// questions and conditions, in English, Tamil and Hindi. A question that asks for one is worth a
// look (medium); a condition or decision that reads one treats people differently by it (high).
// Lawful differences exist (a women's hostel, a senior citizens' discount, reserved scholarships):
// these are findings for a person to weigh, never errors, and a reviewer may accept a service with
// a high finding by writing why (ETH-4). The check reads the design only; it never collects anything.
import type { Field } from "./fields.js";
import type { Journey, Step } from "./journeys.js";

export const PROTECTED_ATTRIBUTES = ["gender", "caste", "religion", "colour", "nationality", "region", "language", "disability", "age", "marital status"] as const;
export type ProtectedAttribute = (typeof PROTECTED_ATTRIBUTES)[number];

/**
 * Words that name or ask for each attribute. English matches whole words or phrases; Tamil and
 * Hindi match inside a word too, since suffixes join on (சாதியை, जाति का). Words that are mostly
 * innocent ("community", "language" alone, "colour" alone, "single", Tamil ஆண் which begins ஆண்டு
 * "year", Hindi जात which begins जाता "goes") are left out on purpose.
 */
export const ETHICS_WORDS: Record<ProtectedAttribute, { en: string[]; ta: string[]; hi: string[] }> = {
  gender: { en: ["gender", "sex", "male", "female", "transgender", "woman", "women"], ta: ["பாலினம்", "பெண்", "திருநங்கை"], hi: ["लिंग", "पुरुष", "महिला", "स्त्री", "ट्रांसजेंडर"] },
  caste: { en: ["caste", "sub caste", "subcaste", "jati", "jaati", "obc", "scheduled caste", "scheduled tribe", "dalit", "tribe"], ta: ["சாதி", "ஜாதி"], hi: ["जाति", "अनुसूचित"] },
  religion: { en: ["religion", "religious", "faith", "hindu", "muslim", "christian", "sikh", "jain", "buddhist", "parsi"], ta: ["மதம்", "சமயம்"], hi: ["धर्म", "मज़हब", "मजहब"] },
  colour: { en: ["complexion", "skin colour", "skin color", "skin tone", "race", "racial"], ta: ["தோல் நிறம்"], hi: ["त्वचा का रंग", "रंगत"] },
  nationality: { en: ["nationality", "citizenship", "foreigner", "ethnicity", "ethnic", "country of origin"], ta: ["தேசியம்", "குடியுரிமை"], hi: ["राष्ट्रीयता", "नागरिकता"] },
  region: { en: ["native place", "native state", "home state", "hometown", "domicile", "state of origin"], ta: ["சொந்த ஊர்", "பூர்வீகம்"], hi: ["मूल निवास", "अधिवास", "मूल स्थान"] },
  language: { en: ["mother tongue", "native language", "first language"], ta: ["தாய்மொழி"], hi: ["मातृभाषा"] },
  disability: { en: ["disability", "disabled", "handicap", "handicapped", "impairment", "differently abled"], ta: ["மாற்றுத்திறன்", "ஊனம்"], hi: ["विकलांग", "दिव्यांग"] },
  age: { en: ["age", "date of birth", "dob", "birth date", "year of birth"], ta: ["வயது", "பிறந்த தேதி"], hi: ["उम्र", "आयु", "जन्म तिथि"] },
  "marital status": { en: ["marital status", "married", "unmarried", "widow", "widowed", "divorced", "divorcee"], ta: ["திருமண"], hi: ["वैवाहिक", "विवाहित", "अविवाहित", "विधवा"] },
};

export type EthicsFinding = {
  severity: "high" | "medium";
  attribute: ProtectedAttribute;
  step: string;
  /** The field that asks for it, when there is one. */
  field?: string;
  /** Quotes the field or screen, so a bundle can point at its line. */
  message: string;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS: [ProtectedAttribute, RegExp][] = PROTECTED_ATTRIBUTES.map((a) => {
  const w = ETHICS_WORDS[a];
  const latin = w.en.map((x) => `(?<![\\p{L}\\p{N}])${escape(x).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`);
  // At the start of a word only: suffixes join on after it, never before.
  const indic = [...w.ta, ...w.hi].map((x) => `(?<![\\p{L}\\p{M}])${escape(x).replace(/ /g, "\\s+")}`);
  return [a, new RegExp([...latin, ...indic].join("|"), "iu")];
});

/** The protected attribute some text names, or null. Ids read as words ("marital_status", "dateOfBirth"). */
export function protectedAttributeIn(text: string | undefined | null): ProtectedAttribute | null {
  if (!text) return null;
  const t = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .normalize("NFC");
  for (const [a, re] of MATCHERS) if (re.test(t)) return a;
  return null;
}

/** What a field is about: its id and label first, then its options. */
function fieldAttribute(f: Field): ProtectedAttribute | null {
  return protectedAttributeIn(f.id) ?? protectedAttributeIn(f.label) ?? protectedAttributeIn((f.options ?? []).map((o) => `${o.value} ${o.label}`).join(" | "));
}

/** The conditions a step holds: its fields' `when`, its decisions and its branching `next`. */
function conditionsOf(s: Step): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const f of s.fields ?? []) if (f.when) out.push({ where: `field '${f.id}'`, text: f.when });
  for (const b of s.decide ?? []) if (b.if) out.push({ where: `screen '${s.id}'`, text: b.if });
  if (Array.isArray(s.next)) for (const b of s.next) if (b.if) out.push({ where: `screen '${s.id}'`, text: b.if });
  return out;
}

/** The ethics findings of a journey (ETH-1): one per field asking for an attribute, one per condition reading one. */
export function ethicsChecks(j: Journey): EthicsFinding[] {
  const out: EthicsFinding[] = [];
  const asked = new Map<string, ProtectedAttribute>();
  for (const s of Object.values(j.steps))
    for (const f of s.fields ?? []) {
      const a = fieldAttribute(f);
      if (!a) continue;
      asked.set(f.id, a);
      out.push({
        severity: "medium",
        attribute: a,
        step: s.id,
        field: f.id,
        message: `field '${f.id}' asks for ${a}, a protected attribute. Ask for it only if the service needs it, and say why in its description.`,
      });
    }
  for (const s of Object.values(j.steps))
    for (const c of conditionsOf(s)) {
      // A condition reading an answer that is a protected attribute, or naming one outright.
      const ref = [...c.text.matchAll(/\b(?:answers\.[\w-]+|values)\.([\w-]+)/g)].map((m) => m[1]!).find((id) => asked.has(id));
      const a = ref ? asked.get(ref)! : protectedAttributeIn(c.text.replace(/\b(?:answers|values|context)\./g, ""));
      if (!a) continue;
      out.push({
        severity: "high",
        attribute: a,
        step: s.id,
        ...(ref ? { field: ref } : {}),
        // Only the screen or field is quoted, so the problem's line is the condition's.
        message: `${c.where} treats people differently by ${a}${ref ? ` (it reads the answer ${ref})` : ""}. That is allowed only for a lawful purpose, such as a women's hostel or a senior citizens' discount: state it, and a reviewer must accept it with a reason.`,
      });
    }
  return out;
}
