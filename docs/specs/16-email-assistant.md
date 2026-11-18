# 16 The email assistant

A person adds `review@anjalai.cc` to an email as Cc or Bcc, or forwards a thread to it. Anjal shows a review card on the tenant's kiosk with 2 to 4 key points and an editable reply draft. Nothing is sent until a person taps **Approve & Send**, and the reply then leaves from the person's own Gmail.

Each email opens a case of a built-in **Email review** service, so it can be handed between roles: a receptionist can pass a draft to the doctor, or a staff member to the owner. The cloud holds the email only in transit. The lasting record lives on the tenant's box, or on its devices when it has no box.

Source: *Anjal Email Assistant: Review & Draft Spec* (2026-11-18), reviewed that day. The changes from that review are below; the IDs keep the doc's own FR and NFR numbers as `EML-` and `EMN-`.

**Changes from the design doc:**
- One brand and one address: `review@anjalai.cc`. AskNoah and Joan are dropped, and the brand id goes.
- Connecting Gmail is a stored permission to send (an OAuth grant held like a connector secret), not a way to sign in. It doesn't wait for accounts (15); once accounts exist, the grant belongs to the person's account.
- Routing (verified senders, tenant settings, known threads) is kept in the platform database (PLA-2), because the email arrives at one Worker and its tenant may be on any edition.
- Today the relay carries only case and reassign envelopes, and devices have a secret but no keypair. So this spec adds an `email` envelope kind and device and box keypairs.
- The single team hub would ping every tenant's kiosks. Notifications go through the tenant's own hub (TEAM-52).

## Onboarding

| ID | Requirement | Status |
|---|---|---|
| EML-1 | From Preferences → Email assistant, a tenant administrator connects Gmail through Google OAuth (authorization code with PKCE, offline access). The connected Google address becomes a verified sender for the tenant. | Planned |
| EML-2 | Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.send`. `https://www.googleapis.com/auth/calendar.events` is asked for only the first time someone taps "Add to calendar". Never `gmail.readonly` or `gmail.modify`. Revoking the grant stops sending, and the kiosk shows "Reconnect Gmail". | Planned |
| EML-3 | A tenant may register more sender addresses. Each one is verified by a one-time link mailed to it. Email from an unverified address is dropped and counted as `unverified_sender`. | Planned |
| EML-4 | The Google OAuth app must pass Google's verification (`gmail.send` is a sensitive scope) before public launch. Allow 2 to 6 weeks. | Planned |

## Receiving and filtering

| ID | Requirement | Status |
|---|---|---|
| EML-10 | Email Routing for `anjalai.cc` delivers `review@` to an `email()` handler beside the Hono `fetch` handler in one edition's Worker, which finds the tenant in the platform database. | Planned |
| EML-11 | The trigger is read from the headers. **Cc**: `review@` is in Cc. **Bcc**: it is the envelope recipient but in neither To nor Cc. **Forward**: `Fwd:`/`Fw:` or a forwarded-message marker, with the original From, Date and Subject parsed out. In Bcc mode the draft never names `review@`. | Planned |
| EML-12 | In Forward mode, the text above the marker becomes the person's instruction (up to 1,000 characters). It steers the draft but cannot change the persona's rules. | Planned |
| EML-13 | The From domain must pass DMARC (from `Authentication-Results`), and the From address must be a verified tenant sender. An external sender is accepted only when their `In-Reply-To` or `References` matches a Message-ID the tenant sent with `review@` on it (kept for 90 days). | Planned |
| EML-14 | Dropped: `List-Unsubscribe`, `List-Id`, `Precedence: bulk/list/junk`, `Auto-Submitted` other than `no`, senders `noreply@`, `no-reply@` and `mailer-daemon@`, and `anjalai.cc` itself. A draft never puts `review@` in To, Cc or Bcc. | Planned |
| EML-15 | Only an authenticated tenant sender gets a rejection with a reason. Everything else is dropped silently, so nobody can probe which addresses are valid. | Planned |
| EML-16 | Per-tenant limits, 10 an hour and 30 a day by default, are counted in a per-tenant Durable Object. An email over the limit is held as a `PAUSED` envelope, and the kiosk offers "Paused: 30 emails today. Resume?" Resuming processes them in order of arrival. | Planned |
| EML-17 | The Worker keeps the raw MIME in memory only. It parses it (postal-mime) and writes it, sealed (EMN-2), as a relay envelope of kind `email`, deleted on pickup or after 48 hours. No email content goes to D1 outside that envelope, or to KV or logs. | Planned |

## Drafting

| ID | Requirement | Status |
|---|---|---|
| EML-20 | The box (or a kiosk device when there is no box) opens the envelope, opens an Email review case and keeps the email in its own store. The store is a rolling buffer (2,000 items or 500 MB by default): dismissed rows go first, then sent ones. Pending ones are never removed. | Planned |
| EML-21 | The model returns JSON checked against a zod schema: 2 to 4 summary bullets (140 characters at most each), urgency, a suggested action (REPLY_EMAIL, ADD_CALENDAR_EVENT, ARCHIVE_ONLY, NEEDS_HUMAN), an optional calendar event, the draft's subject ("Re: " once), recipients and body. Invalid JSON is retried once, then shown as NEEDS_HUMAN. | Planned |
| EML-22 | The email body is untrusted data, passed as quoted data and never as instructions. The model has no tools in this step. | Planned |
| EML-23 | Each tenant chooses the model: a provider from the allowlist, or Ollama on the box. Clinics default to local. | Planned |
| EML-24 | The tenant's persona (home, business or clinic; community once EDN-1 exists) sets the tone and hard rules. Home: dates and amounts become calendar suggestions, and Anjal never pays or confirms a payment. Business: prices and hours only from the tenant's catalogue, and a price that isn't there becomes `[price?]`. | Planned |
| EML-25 | Clinic persona: administrative and scheduling replies only. Every draft is checked before the card is shown, and one with clinical content is replaced by the fixed hand-off line ("The doctor will review this and contact you.") and flagged `CLINICAL_REVIEW`. The clinical check comes from the Clinux realm; YAxb stays free of health content. | Planned |

## Review and approval

| ID | Requirement | Status |
|---|---|---|
| EML-30 | The card shows the sender, the subject, the trigger, an urgency chip, the bullets, the editable draft, the recipients and the attachment names. It reaches every online kiosk of the role named in the tenant's routing within 5 seconds with a cloud model. | Planned |
| EML-31 | Approve & Send queues the reply in an outbox with `In-Reply-To` and `References` set, so Gmail threads it. Status: PENDING → QUEUED → SENT, or FAILED with Gmail's error. | Planned |
| EML-32 | A voice edit through Ask Me rewrites only the draft and shows the change before it applies, with undo. | Planned |
| EML-33 | Dismiss keeps the summary in the archive. Hand over passes the case to another role with a note (LIB-33..38). | Planned |
| EML-34 | When a reply is sent, the difference between the draft and what was sent is kept on the box. The persona uses the last 20 as examples. They never go to the relay. | Planned |

## Security, privacy and reliability

| ID | Requirement | Status |
|---|---|---|
| EMN-1 | The box only opens outbound connections. It pulls `email` envelopes from the relay over HTTPS with its device credential (IDN-18, or a box key until then). A Cloudflare Tunnel is optional. | Planned |
| EMN-2 | Each envelope is sealed (X25519 + XChaCha20-Poly1305) to the tenant box's public key, or to each kiosk device's key when there is no box. Devices and the box get a keypair, and the tenant's public keys are kept in the platform database. The Worker can't read an envelope after writing it. | Planned |
| EMN-3 | On the box, the body, the draft, the sent text and the Google refresh token are sealed fields. Litestream replicas carry only the sealed values. Until the box holds it, the refresh token is kept in D1 encrypted with a Worker secret. | Planned |
| EMN-4 | Each tenant has its own grant, store and style examples. Every query filters by tenant. | Planned |
| EMN-5 | Within 500 ms at p95 at the edge; the card within 5 s at p95 with a cloud model and within 60 s with Ollama on a Pi 5. Measured by the events `email.received`, `email.relayed` and `email.card_shown`. | Planned |
| EMN-6 | Offline, cards on the box stay readable and editable. The outbox retries with backoff (1, 5 and 15 minutes, then hourly for 48 hours), sends at most once per review, and tells the person when it gives up. | Planned |
| EMN-7 | Before the first email, the tenant accepts a consent form (CON) saying what is processed, by which provider, and for how long. Without it, email is dropped as `no_consent`. A clinic's replies say "This reply was drafted with assistance and reviewed by staff." | Planned |
| EMN-8 | Every status change writes an audit row with no content. | Planned |
| EMN-9 | Envelopes are capped at the relay's 256 KB. Text over 200 KB is truncated, and the card says so. Attachments are never stored: their names only. | Planned |
| EMN-10 | The same email arriving by Cc and by forward makes one card (unique per tenant and Message-ID). | Planned |

## Order of work

1. Without hardware or Google's verification: EML-10..17 and 20..22, and EMN-2, 4, 7..10 to kiosk devices, with a test Google app in testing mode. Gate: a forwarded email makes a card on a kiosk, and a log and D1 search for its subject finds nothing after pickup.
2. EML-1..3, 30..33 on a pilot tenant. Gate: a reply sent from the kiosk threads in the same Gmail conversation.
3. With the box deployed: EMN-1, 3, 6 and EML-34. Gate: three pilot tenants, one per persona, each approve 50 replies with no incident, and a box restore drill succeeds.

## Open

- Whether the email assistant is free on the relay, or a paid feature. To be decided with the paid plan.
