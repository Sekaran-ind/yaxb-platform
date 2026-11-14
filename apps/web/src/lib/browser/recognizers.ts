// Typed values in any language (JRN-16): phone numbers, emails, web addresses, money and measures,
// read on this device with Microsoft Recognizers-Text (MIT). Digits, symbols and addresses read the
// same whatever language surrounds them ("என் எண் +91 98765 43210", "₹500", "21 km"), so the English
// rules serve every language; money written as a word in another language ("500 रुपये") is left to
// the other passes. Loaded only when a form has such a field (about 250 KB gzipped, its own chunk),
// never in the Worker. Dates are read by the core's own rules.
import type { TypedValue } from "@sekaran-ind/yaxb-core/journeys";

const CULTURE = "en-us";
type Result = { typeName: string; text: string; resolution?: { value?: string; unit?: string; isoCurrency?: string } | null };

let loaded: Promise<[typeof import("@microsoft/recognizers-text-sequence"), typeof import("@microsoft/recognizers-text-number-with-unit")]> | null = null;
const load = () => (loaded ??= Promise.all([import("@microsoft/recognizers-text-sequence"), import("@microsoft/recognizers-text-number-with-unit")]));

/** Every typed value in `text`, in the order found per kind. */
export async function recognizeValues(text: string): Promise<TypedValue[]> {
  const [sequence, units] = await load();
  const t = text.slice(0, 2000);
  const out: TypedValue[] = [];
  const add = (kind: TypedValue["kind"], rs: Result[], numeric = false) => {
    for (const r of rs) {
      const raw = r.resolution?.value ?? r.text;
      if (raw === undefined || raw === null || raw === "") continue;
      const unit = r.resolution?.isoCurrency || r.resolution?.unit;
      out.push({ kind, text: r.text, value: numeric && Number.isFinite(Number(raw)) ? Number(raw) : String(raw), ...(unit ? { unit } : {}) });
    }
  };
  add("email", sequence.recognizeEmail(t, CULTURE) as Result[]);
  add("url", sequence.recognizeURL(t, CULTURE) as Result[]);
  add("phone", sequence.recognizePhoneNumber(t, CULTURE) as Result[]);
  add("money", units.recognizeCurrency(t, CULTURE) as Result[], true);
  add("measure", [...units.recognizeDimension(t, CULTURE), ...units.recognizeTemperature(t, CULTURE)] as Result[], true);
  return out;
}
