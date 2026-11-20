// Routes: forms. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { z } from "zod";
import { settings } from "../env";
import { MAX_FORM_BODY, jsonError, sameOrigin, ip, withinLimit, readJson } from "../http";

const contactSchema = z.strictObject({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.email("Please enter a valid email").max(254),
  message: z.string().trim().min(1, "Please enter a message").max(5000),
  organisation: z.string().trim().max(160).optional().default(""),
  // Honeypot: real users never fill this hidden field.
  company: z.string().max(0).optional().default(""),
});
const newsletterSchema = z.strictObject({ email: z.email("Please enter a valid email").max(254) });
/** Contact form -> the helpdesk Worker (as ClinüxFlow's), else Airtable. Tokens stay in the Worker. */
app.post("/api/contact", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `contact:${ip(c)}`))) return jsonError(c, 429, "Too many messages. Please try again later.");
  const parsed = contactSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid form.");
  if (parsed.data.company) return c.json({ ok: true }); // honeypot: silently drop bots
  const { HELPDESK_URL, AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME } = settings(c.env);
  const { name, email, message, organisation } = parsed.data;
  const failed = () => jsonError(c, 502, "That didn't send. Please write to helpdesk@yaxb.ai.");
  if (HELPDESK_URL) {
    const res = await fetch(HELPDESK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", name, clinic: organisation, email, message }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { success?: boolean } | null;
    return res?.ok && body?.success ? c.json({ ok: true }) : failed();
  }
  if (!AIRTABLE_API_TOKEN || !AIRTABLE_BASE_ID) return jsonError(c, 503, "The contact form is not configured. Please write to helpdesk@yaxb.ai.");
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: { Name: name, email, message: organisation ? `${organisation}: ${message}` : message } }], typecast: false }),
  }).catch(() => null);
  return res?.ok ? c.json({ ok: true }) : failed();
});

/** Newsletter signup -> Mailchimp (double opt-in). */
app.post("/api/newsletter", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("form", c.env.FORM_LIMITER, `newsletter:${ip(c)}`))) return jsonError(c, 429, "Too many requests.");
  const parsed = newsletterSchema.safeParse((await readJson(c, MAX_FORM_BODY)).body);
  if (!parsed.success) return jsonError(c, 422, parsed.error.issues[0]?.message ?? "Invalid email.");
  const { MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID } = settings(c.env);
  if (!MAILCHIMP_API_KEY || !MAILCHIMP_AUDIENCE_ID) return jsonError(c, 503, "Newsletter is not configured.");
  const dc = MAILCHIMP_API_KEY.split("-").pop();
  const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${MAILCHIMP_AUDIENCE_ID}/members`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`any:${MAILCHIMP_API_KEY}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email_address: parsed.data.email, status: "pending" }),
  }).catch(() => null);
  // "Member Exists" is reported as success so the endpoint can't be used to probe the list.
  if (res && (res.ok || res.status === 400)) return c.json({ ok: true });
  return jsonError(c, 502, "Subscription failed. Please try again later.");
});
