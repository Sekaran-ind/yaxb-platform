# 12 Platform and editions

Anjal has three editions on one core: **Family** (a household), **Business** (a small business) and **Community** (an apartment association, a club, a place of worship's committee, a self-help group, a parents' group). Almost every feature carries over between them with different templates, words and defaults. Three things really differ: who decides (parents and committees, not managers), who is protected (children and elders), and what is never built (face recognition and location tracking at home).

Source: the design reports *Anjal Family and Community Editions* (2026-11-16) and *Anjal: Media, FaceOps, Connectors and Routines* (2026-11-16), reviewed on 2026-11-18. Decisions taken in that review are recorded here as requirements.

## The shared platform layer

Each edition is its own Worker with its own database (SUR-1). With spaces (15, SPC-1..10) the person chooses their family, business or community inside the app, and that choice decides the sections; an edition's site then becomes a front door that offers only spaces of its kind. Shared code is already in the npm packages (yaxb-core, yaxb-journeys). Records that every edition must read and write go in one more database, bound to every edition's Worker. It is not a separate service.

| ID | Requirement | Status |
|---|---|---|
| PLA-1 | One D1 database, `anjal-platform`, must be bound to every edition's Worker (binding `PLATFORM_DB`) next to that edition's own `DB`. Its migrations live in yaxb-core beside the edition migrations, in their own folder. | Built: `PLATFORM_DB` in the wrangler file (one Worker for every edition since SUR-14), migrations in `packages/yaxb-core/migrations-platform` (0001: `platform_meta`). The remote database is created at the first deploy. |
| PLA-2 | Only records that cross editions go in the platform database: accounts and their sign-in methods (15), the approved-sites catalogue (14), email routing (16) and the directory. Cases, the catalogue, reviews, the team, conversations and everything else stay in the edition's own database. | Partly built: accounts, sign-in methods, memberships, sessions, signing keys and the identity audit (platform migration 0002). The approved sites, email routing and the directory come with their features. |
| PLA-3 | The code that uses the platform database must live in yaxb-core under its own exports (`./identity`, `./sites`, `./email`), like `./tenants` and `./library` today, with memory and D1 stores tested on both. | Partly built: `./identity` (memory and D1 stores, tested on both). |
| PLA-4 | Every query on the platform database that touches tenant data must name the tenant and the edition, so a family tenant and a business tenant with the same id cannot meet. | Planned |
| PLA-5 | A developer's local run (`node yaxb.mjs start`) must create and migrate a local `anjal-platform` beside the edition database, as it does for `DB` today. | Built: `node yaxb.mjs start` (and `db:migrate:local`) migrates a local `anjal-platform`. |

## Domains

| ID | Requirement | Status |
|---|---|---|
| DOM-1 | The editions are served at `family.anjalai.cc`, `business.anjalai.cc` and `community.anjalai.cc`. The custom domains must be declared in the wrangler file, so a deploy keeps them, and the portal's `VITE_*_URL` defaults must point at them. | Built: one Worker declares every address (anjalai.cc, the three editions' and yaxb.ai) as `routes` with `custom_domain` (SUR-14); the portal's links default to the anjalai.cc domains. |
| DOM-2 | The account session cookie (IDN, 15) must be scoped to `.anjalai.cc`, so one sign-in works on every edition. Each edition's own cookies (`yaxb_sid`, the member cookie) stay host-only. | Built: `anj_at` and `anj_rt` are scoped to `.anjalai.cc` there; `anj_space` and the edition's own cookies stay host-only. With one address for every edition (SUR-14) the shared scope matters less, and it stays while the subdomains are addresses. |
| DOM-3 | Passkeys must use the relying-party id `anjalai.cc`, so a passkey made on one edition works on the others. | Built: the relying party is `anjalai.cc` on every edition. |
| DOM-4 | The email assistant's address is `review@anjalai.cc` (16); Email Routing for `anjalai.cc` must be on the same Cloudflare account. | Planned |
| DOM-5 | The `*.workers.dev` addresses may stay for testing. Nothing that needs a shared site (passkeys, the shared cookie, OAuth redirects) is offered there. | Built: other addresses offer no passkeys; the session cookies are host-only there. |

## The Community edition

| ID | Requirement | Status |
|---|---|---|
| EDN-1 | Tenants must have a third kind, `community`, beside `business` and `family` (a migration of `tenants.kind`). | Built: `Tenant.kind` takes `community` (`tenants.kind` is plain text, so no migration was needed). |
| EDN-2 | yaxb-core's context must have a `community` surface. It offers what Business offers (the catalogue, requests, staff, the front desk, join links, the directory), plus profiles and the child lock from Family. | Built: the `community` surface offers everything but household requests. |
| EDN-3 | The Community edition is its own Worker (`anjal-community`, `wrangler.community.jsonc`, `vite build --mode community`) with its own database and secrets, like the other two (SUR-1), and the platform database (PLA-1). | Built, then folded into one Worker (SUR-14): community.anjalai.cc is an address of `yaxb-web`, and the database anjal-community is its `DB_COMMUNITY`. |
| EDN-4 | The Community edition must have its own home page and words: residents, the committee, blocks, the hall, dues, notices. The "Apartment association" idea moves there from the Family home page. | Built: `pages/CommunityHomePage.vue`, the Community slide and ideas (the apartment association moved from Family, and a temple or club committee). |
| EDN-5 | The portal must offer Community as its own card, and "Which fits you?" must be able to point to it. | Built: the portal's Community card, and "My association, club or committee" in Which fits you? |
| EDN-6 | A committee's roles change at each election. The community organisation (ORG, 13) gives each committee role a term and an election hand-over that moves the role, its open cases and its records to the new holder in one step. | Planned |
| EDN-7 | A committee must never be able to read a member's own notebook, journal, conversations or family data. It sees only the complaints, bookings and dues that come to it. | Planned |
| EDN-8 | When a member leaves a community, their access must end at once. Their past complaints stay as the association's records. | Planned |
| EDN-9 | A message to every member must have a committee member's approval, respect each member's opt-out, and stay within the tenant's sending limits. | Planned |
| EDN-10 | A community records its own identifiers (society, trust or cooperative registration, PAN, 12A and 80G, GSTIN where it applies) with the four trust levels of ORG-6. Members are checked by the committee against their flat or membership number, never by an ID document. Aadhaar is never collected. | Planned |

## Household requests in Family

The Family home page promises children asking and parents approving, but the Family edition switches requests off today.

| ID | Requirement | Status |
|---|---|---|
| EDN-20 | The Family edition must offer requests between household members: a child or an elder asks, a parent decides; a repair goes to whoever handles repairs. These are cases (LIB-33..38) kept on the household's devices (LIB-42), never on the central store. | Built for one shared family device: requests are household cases on this device (`entry` household, never central); the next person sees them when they open their profile. Households across several devices wait for the box sync. |
| EDN-21 | A child's request must always go to one of the child's guardians. A child cannot join a community, and cannot be messaged by one directly. | Partly built: a child's request reaches only that child's guardians (core `householdAllows`, the case service's `allows`). Communities don't exist yet. |
| EDN-22 | Family must offer built-in household services: ask for something, report a repair, plan an outing. | Built: the At home service (`HOUSEHOLD_SERVICE_YAML`): Ask for something, Report a repair, Plan an outing. |
| EDN-23 | Families are never listed in the directory. | Built: Family has no directory, and households aren't tenants. |
| EDN-24 | Each adult's notebooks and conversations are private unless shared. Parents see a child's requests, not the child's conversations, by default. | Partly built: notebooks and conversations stay with each profile; parents see a child's requests only. Sharing a notebook or a conversation is open. |

## Children and elders

| ID | Requirement | Status |
|---|---|---|
| EDN-30 | An under-18 profile must be linked to its guardians. A parent gives consent for the child, per service (CON). | Planned |
| EDN-31 | For children, in every edition: no location tracking, no face recognition, no cloud processing of their photos, no advertising. | Planned |
| EDN-32 | An elder's profile may name a trusted contact who, with the elder's consent, can help, see pending requests and receive check-in alerts. | Planned |
| EDN-33 | Elder check-in: a routine (RTN, 14) asks each morning "Are you fine?"; no answer by a set time alerts the trusted contact or a volunteer. No location is used. | Planned |
| EDN-34 | Scam guard: a payment link, a request for an OTP or a message from an unknown caller must be flagged before an elder acts on it. | Planned |
| EDN-35 | "I've reached" is a tap on the person's own phone, with an optional one-time place check. Continuous tracking is never offered. | Planned |

## Utility bill checks

| ID | Requirement | Status |
|---|---|---|
| BIL-1 | A family adds its consumer numbers once (electricity, water, property tax). Anjal checks the amount due and the due date, puts the date in the Scheduler and reminds the family a few days before. It only reads. Paying always happens on the biller's site or the family's UPI app. | Planned |
| BIL-2 | A bill is fetched through BBPS bill fetch when the biller is covered, as a declarative connector (CNX, 14). | Planned |
| BIL-3 | Otherwise, a read-only lookup on the biller's own public page, under all of WEB-30..35 (14). It is designed and built as part of the Playwright work (WEB), with no separate track. | Parked |
| BIL-4 | Consumer numbers are kept in the family's sealed vault (PRF), never in logs or audit records. `bill.checked` records only the biller and whether it worked. | Planned |
| BIL-5 | The Bills card shows each account's amount due and due date, with "Pay on the biller's site" and "Pay with UPI" links. Bills are stored as schema.org `Invoice`, so household spending can be charted (VIS, 13). | Planned |
| BIL-6 | An association can use the same catalogue for its common-area connections, seen by the treasurer's role. | Planned |

## Community dues and the journal

| ID | Requirement | Status |
|---|---|---|
| EDN-40 | A community collects dues through a payments connector (CNX, 14) with receipts; the treasurer exports the month's collection. Nothing pays automatically: a routine may prepare a payment link, and a person always confirms it. | Planned |
| EDN-41 | The family journal: a scrollable timeline (VIS-4, 13) of the family's moments, each an Event with photos, a note and the people in it, kept on the device or the home box. | Planned |
| EDN-42 | Community events, notices and decisions on a timeline, and the facilities on a site map (VIS, 13), both working offline from the office box. | Planned |
| EDN-43 | At a community gate, a kiosk in Restricted Mode takes a visitor's name, the flat and (with consent) a photo, and asks the resident to approve. The photo is never matched against anything and is deleted after a short period. | Planned |

## Never built

| ID | Requirement | Status |
|---|---|---|
| EDN-50 | Face recognition in the Family edition, and face recognition of children in any edition. | Planned (as a rule) |
| EDN-51 | Continuous location tracking of anyone, including children. | Planned (as a rule) |
| EDN-52 | Community attendance by face. QR or a tap on the member's own phone is enough. Face matching in Community is only for the association's own employees, under FACE (14). | Planned (as a rule) |

## Order of work

1. EDN-1..5 and EDN-20..24, with PLA-1..5 and DOM-1. Gate: an apartment association runs complaints and hall bookings, and a child's request reaches a parent, both from templates.
2. EDN-6 with ORG (13). Gate: a new committee takes over roles, open cases and records in one step.
3. The rest after the foundations they use (13, 14).
