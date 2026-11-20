# 14 Media, connectors, routines and websites

Photos, audio and video in services; attendance (FaceOps rebuilt on Anjal); connectors to a business's other systems; hooks and routines that act on events and schedules; dependencies between departments and businesses; and the approved websites Anjal may read.

Anjal's rule for text applies to all of it: process on the device first, then on the box, and use the cloud only when the plan and the person's consent allow it.

Source: *Anjal: Media, FaceOps, Connectors and Routines* (2026-11-16), reviewed on 2026-11-18. Features that need the paid plan or carry the highest risk are **Parked** until consent forms, licences and limits are in place.

## Media

| ID | Requirement | Status |
|---|---|---|
| MED-1 | Media is stored apart from records and referenced by content hash: IndexedDB on the device, files on the box, R2 on the server. Sync rows and case envelopes carry the hash, and a blob moves only when the receiver needs it. A case envelope never carries a photo inline. | Partly built: photos are kept apart from records by SHA-256: IndexedDB `yaxb-media` on the device (`lib/browser/media.ts`) and `/v1/media/<hash>` on the box (SQLite `media`, checked against its hash, replicated by Litestream). Answers and requests carry only `MediaRef`s; a photo or voice note goes up to the box whenever one is connected unless its field says `keep: device` (or when the box can be reached again) and down when a device that never had it shows it. Decided 2026-11-20: photos and voice notes go to the box whenever one is connected; cloud storage (R2, `keep: server`) is the paid tier, like central requests, and waits for the owner's go-ahead to create a bucket |
| MED-2 | A camera and microphone capture component in yaxb-journeys/vue, with preview, retake and size limits, used by the kiosk and the native app (Capacitor camera on a device). | Partly built: yaxb-journeys/vue `MediaCapture` (take a photo with the camera or choose one, see it, take it again or remove it, up to `max`; made smaller to 1600 px JPEG under 2 MB) with a host from `provideMedia` (`media.ts`; memory by default). Works in the native app through its web view's camera; the microphone (audio) is for MED-9 |
| MED-3 | Every media item has a text form stored beside it (transcript, OCR text, caption), so the agent, search and slot filling work on media unchanged, and a citation can point at a photo or a time in a clip. | Built for photos: the text read from a photo is kept beside it (on the device) and in its reference (`MediaRef.text`), so summaries, the agent and search see it |
| MED-4 | New field types: `photo` (capture, max, read: ocr/caption/none, keep: device/box/server), `audio` (max_seconds, transcribe: device/server/none, keep), `video` (max_seconds, keep) and `file` (accept, keep). | Partly built: `photo` (`max` 1..5, `read: ocr | caption | none`, `keep: device | box | server`), checked by `fieldListProblems` and `fieldProblem`; never slot-filled; summaries say "1 photo: <text>" and requests show the photos (`MediaThumbs`). `audio` is built (MED-9); `video` and `file` come next |
| MED-5 | Photos are read on the device first (Tesseract.js with Tamil and Hindi, or Florence-2). A cloud vision model is used only when the service allows it and the consent form says so. | Partly built: the text in a photo is read on the device with Tesseract.js 7 (Apache-2.0) in English and the kiosk's language (`lib/browser/ocr.ts`; Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali and the others; checked on English and Tamil text in Chromium), and a description with Florence-2 (MIT, `media.worker.ts`). PaddleOCR (PP-OCR through ONNX Runtime Web) is the more modern option to compare against on real photos. No cloud vision model yet |
| MED-6 | New handlers, each saying whether data leaves the device: `media.transcribe`, `media.read` (OCR or caption), `media.extract` (fill named fields from a photo or document, checked like `kiosk.extract`) and `call.start` (a video call with the role that finishes the case). | Partly built: `media.read` (a photo's text or a description) and `media.transcribe` (a voice note's words), on the device, declared as staying on it (SERVICE_INFO `where: device`). `media.extract` and `call.start` are open |
| MED-7 | The AI designer knows the new types and handlers, with one built-in example per pattern (photo report, voice note, document capture). The flow checks warn when a media field keeps data on the server but the service's storage is none or box. The preview's stand-ins return a sample transcript or OCR text. | Partly built: the designer agent knows `photo` and `audio` (their options, and to ask for photos of people or ID only when needed), with a built-in example (`content/designer/photo-report.example.yaml`: a photo read on the kiosk and a voice note written down, both kept on the box). The flow check for media kept on the server against a service's storage, and the preview's sample texts, are open |
| MED-8 | The Legal Guardian counts media: a photo of a person and any voice recording raise the sensitivity, and the form says where media is kept and for how long (default 30 days for recordings). | Partly built: a photo and any voice recording raise a question's sensitivity (`photo`, `voice`), and the consent form says they are kept apart and read on the device. How long they are kept is open |
| MED-9 | Recorded audio is transcribed on the device (Whisper or Moonshine in a worker) or, when the service allows, by Workers AI. | Built: an `audio` field (`max_seconds` up to 300, `transcribe: device | none`, `keep`) records a voice note (MediaRecorder), plays it back at once, and writes it down on the device with Whisper base (MIT) through Transformers.js (`transcribeAudio`, decoded to 16 kHz on the page). Workers AI transcription is open |
| MED-10 | Children's photos are never sent to a cloud model. The child lock turns off cameras and microphones for media fields. | Built for photos: the child safety lock turns the camera off for photo fields (`allowed()` in the kiosk's media host); photos are only read on the device, never by a cloud model |
| MED-11 | Events: `media.captured`, `media.read`, `media.sent_to_model` with the provider's name. Never the media itself. | Partly built: `media.captured` and `media.read` (with how long it took and whether it worked), never the media. `media.sent_to_model` comes with a cloud model |
| MED-12 | Every model's licence must be checked before it ships. | Partly built: Florence-2 (MIT) and Whisper (MIT) are checked; any further model needs the same check |

## Attendance

FaceOps is rebuilt as an Attendance service on Anjal for Business, not ported. Most of it already exists: campaigns are tenants, employees are members, kiosk mode is Restricted Mode, and advance and leave requests are cases.

| ID | Requirement | Status |
|---|---|---|
| ATT-1 | A check-in journey with QR or PIN. Each check-in is an event with an outcome (in, out, late). Built: the check-in journey with a PIN (seed `content/catalogue/attendance.service.yaml`, handler `attendance.check`); each check is a `journey.outcome` event (`attendance.in`, `.late`, `.out`) with the employee as actor. Each employee has a card QR on the roster; scanning it waits for a camera reader. | Partly built |
| ATT-2 | Departments and shifts are synced service data on the business's box (SYN). Built: the roster (departments, shifts, employees) is service data `attendance-roster`, synced through the box (`trackWrite`, newer `updated_at` wins). | Built |
| ATT-3 | A roster view over the events, weekly and monthly, beside the service dashboard. Built: For staff → Attendance → Report (this week, last week, this month; first in, last out, late) from the service's events, with CSV. | Built |
| ATT-4 | A grid view where a manager edits the roster like a spreadsheet, with export to CSV. Built: For staff → Attendance → Roster, a grid of employees, departments and shifts, with export to CSV. | Built |
| ATT-5 | A one-time import of Airtable's CSV export (employees, departments, shifts) into the box. No Airtable account stays in the loop. Dropped (2026-11-20): there is no Airtable data to import. | Dropped |
| ATT-6 | An optional location check with a geofence per site, storing only "inside site X" (VIS-8). Built: an optional geofence per site; the event keeps only `site:<id>` or `outside`. | Built |
| ATT-7 | Attendance totals can be exported to Tally as payroll entries (CNX-4). | Planned |

## Face verification

| ID | Requirement | Status |
|---|---|---|
| FACE-1 | Enrolment is a journey, consent first. The employee takes 3 to 5 photos, and only the face embeddings are kept, encrypted, on the business's box. The photos are discarded. | Parked |
| FACE-2 | Verification is 1:1: the employee first picks their name or scans their QR, then the face is compared with that one template. No search across everyone's faces. | Parked |
| FACE-3 | An active liveness check (blink or turn) on the device. Passive anti-spoofing only on a box with the power for it. | Parked |
| FACE-4 | PIN or QR without a face is always offered. Face is never the only way to check in. | Parked |
| FACE-5 | Models run in the browser (onnxruntime-web in a worker). Elasticsearch or any central face index is never used. | Parked |
| FACE-6 | Templates are deleted when the person leaves. Aadhaar face authentication is never used. Events say match or no match, never the image. | Parked |

## Connectors

Today connectors are MCP servers the operator lists in `MCP_SERVERS`, the same for every tenant.

| ID | Requirement | Status |
|---|---|---|
| CNX-1 | A tenant's administrator can add an MCP connector for their own tenant. | Planned |
| CNX-2 | A `kind: connector` document describes a plain REST API declaratively: a base address, the auth, and named operations. Each operation becomes a journey handler `connector.<id>.<operation>`. | Built: `kind: connector` (yaxb-core `./connectors`: `base` (https), `auth` (none, bearer, header or query, naming its secret), `operations` with `method`, `path`, `query`, `body` filled from `{{input.x}}`, URL-encoded in the path). A catalogue entry kind (migration 0018), added by administrators, reviewed and published like a service; each operation is the handler `connector.<id>.<operation>`; the kiosk sends such a step to `POST /api/connectors/:id/:op` |
| CNX-3 | Connector secrets are stored per tenant on the server, or on the box for box connectors, and are referenced only by name in YAML. A secret never reaches a browser. | Built for the server: secrets are named in YAML, their values set by an administrator in the catalogue (the connector's Secrets view), sealed per tenant (`connector_secrets`), added to the request by the server and never sent to a browser: the catalogue lists only their names. Box connectors' secrets come with CNX-4 |
| CNX-4 | Box connectors reach systems on the office network (Tally first, then printers and devices). | Planned |
| CNX-5 | Every outbound address passes the SSRF guard (SEC-4). Results are wrapped as untrusted data. | Built: every call passes the SSRF guard (`urlProblem`, the host resolved first), follows no redirect, may not leave the connector's address, waits 10 s at most and keeps 200 KB at most; the answer comes back marked `untrusted`. Only an operation a published journey uses can be called, so it is never an open proxy |
| CNX-6 | The journey compiler checks connector handler names like built-in ones, so a typo fails at publish time. | Built: published connectors' handler names are known to the journey compiler, in the library and in the browser (`journeyServiceNames`), so a typo fails before publishing |
| CNX-7 | The Legal Guardian counts connectors as places data goes. | Built: a connector is an outside service (`serviceInfo`, `where: outside`): a journey's privacy line and the consent form say which outside services answers are sent to |
| CNX-8 | Connectors are reviewed and published through the Service Catalogue. Audit: `connector.created`, `connector.secret_rotated`, `connector.removed`. Events: `connector.called` (operation, success, duration), never the payload. | Partly built: connectors are reviewed and published through the Service Catalogue; audit `connector.secret_set` and `connector.secret_removed` (plus the catalogue's own entry audit). The `connector.called` event is open |

## Hooks and routines

| ID | Requirement | Status |
|---|---|---|
| RTN-1 | A `kind: routine` document holds a trigger (schedule, event, webhook or date), a condition (the existing expression language) and actions: start a journey or case, call a connector, message a role, run the agent with a restricted tool list, or record an event. | Partly built (2026-11-20): schedule, event and date triggers; `when`; message, summary, connector and record actions. Webhooks, journeys or cases and the agent wait |
| RTN-2 | Schedules run on Cron Triggers with one Durable Object alarm per tenant, and on the box when offline. | Partly built (2026-11-20): a Cron Trigger every 15 minutes sweeps every edition's businesses (no Durable Object alarm needed yet); the box offline waits |
| RTN-3 | A new routine first runs as a dry run with the stand-in handlers and shows what it would have done. | Built (2026-11-20) |
| RTN-4 | Every run is logged as events (started, each action, finished, failed), so the dashboard shows routines beside journeys. | Built (2026-11-20) |
| RTN-5 | Per-tenant limits on runs per day, model spend and messages sent, with a switch that pauses every routine. | Built (2026-11-20): runs, messages and connector calls per day, and the pause switch; model spend waits for the agent action |
| RTN-6 | An action that sends outside the business (a message, an email, a connector write) can require a person's approval, which is a case for that role. | Built (2026-11-20): `approve: <role>` on a message, connector call or webhook keeps it, rendered, in that role's My work (`routine_approvals`, migration 0020); approved, it is sent under the same limits and logged with its run; undecided ones go after 14 days. An approval in My work, not a case |
| RTN-7 | Only administrators, or a new `automator` role, may publish routines, and a reviewer approves them like services. | Built (2026-11-20) |
| RTN-8 | Notify hooks run after the fact on the existing event kinds, with declarative actions or a signed outgoing webhook. | Built (2026-11-20): an event routine is the declarative notify hook; the `webhook` action POSTs the facts signed (X-Anjal-Timestamp, X-Anjal-Signature: HMAC-SHA256 with the routine's key, derived per edition, business and routine and shown to administrators), through the SSRF guard |
| RTN-9 | Guard hooks may stop a step with a reason the person sees, using a safe condition or a yes-or-no connector call within a time limit. | Built (2026-11-20): an ask step's `guard` (a condition, or a service's yes or no within `within` ms, 10 s at most) keeps the person on the step with the reason; no answer in time stops it. Sequential journeys only |
| RTN-10 | Transform hooks run sandboxed code (an isolate per tenant), with no network except named connectors and with strict limits. | Parked |
| RTN-11 | What a guard or transform returns is stored with the case, so replaying the case never calls the hook again. | Built (2026-11-20): a guard call's answer is kept in the run's `steps["guard:<step>"]`; replay reads it and never calls the hook |
| RTN-12 | Families get ready-made routines from a list of switches, with no YAML. A family routine never messages anyone outside the family without a parent's approval. Transform hooks are not offered in Family or Community. | Built (2026-11-20): Preferences → Family routines: three ready-made reminders a parent switches on (published at once, no YAML), notes to the parents; in Family any connector call or webhook waits for a parent's approval |
| RTN-13 | Nothing pays automatically. | Built (2026-11-20): a connector call whose handler or label looks like a payment is refused |

## Dependencies between departments and businesses

| ID | Requirement | Status |
|---|---|---|
| DEP-1 | A screen may name the service it needs (`uses: { service, journey }`, or `business` for a linked business) with its `with:` values. Anjal starts a child case, and the parent continues when the child ends. | Planned |
| DEP-2 | Only the `with:` values are shared. Between businesses they are shaped as schema.org Order or Invoice, and only under that link's consent. | Planned |
| DEP-3 | The child uses the version published when the parent started (a partner's version is pinned). `timeout:` leads to a fallback step or escalation. | Planned |
| DEP-4 | At publish time: the service exists, its unit is staffed, there is no loop, and a partner's link is active and accepts these inputs. | Planned |
| DEP-5 | Business links: `link.created`, `link.consent_changed` and `link.ended` are audited; `dependency.started`, `dependency.timed_out` and `dependency.fallback` are events. Traces follow AUD-6. | Planned |

## Approved sites and Website access

| ID | Requirement | Status |
|---|---|---|
| SIT-1 | Every outside site Anjal reads, analyses or looks things up on comes from an approved list. There are two tiers: the platform catalogue (kept in the platform database, PLA-2, by the platform's moderators, per country and state, used by every edition) and each tenant's own list. | Built: yaxb-core `./sites` over the platform database (migration 0009): the platform catalogue (kept by the platform's moderators: the portal's administrator or its moderating members) and each business's own list, per region (`*`, `IN`, `IN-TN`) |
| SIT-2 | An entry records its origin and paths, region, category, uses allowed (notebook source, link out, design-time analysis, run-time lookup), the approving moderator, a review date and, for lookups, the recipe and its last good check. Requester and approver are different people. | Built: an entry records its origin and path prefixes, region, category, uses (notebook source, link out, analysed when designing, looked up while a journey runs), who approved it and a review date (a year); whoever asked can't approve or reject it. Lookup recipes and their last good check come with WEB |
| SIT-3 | A tenant can switch platform entries off but cannot loosen them. A third-party site is used for run-time lookups only through the platform catalogue. Families use only the platform catalogue. | Built: a business can switch a platform entry off for itself, never loosen it; run-time lookups come only from the platform catalogue; a family uses only the platform catalogue (`siteVerdict`) |
| SIT-4 | "Ask to add this site" opens a case in the platform moderators' My work queue, with the address, the use wanted and the reason. It names the tenant (or "a family") and never the person or their consumer numbers. Requests for the same site are merged, with a count. | Partly built: "Ask to add this site" (and, until enforced, every unapproved site added to a notebook) opens a request merged by site and use with a count, naming the business or "a family", never the person; the platform's moderators see them in Administration → Approved sites. Requests as cases in My work are open |
| SIT-5 | Website access is a built-in system service in every catalogue (switchable, not deletable), with journeys (add a website to my notebook, check a bill or status, analyse our website, ask to add a site, review a site request) and handlers `web.read`, `web.lookup`, `web.link_out` and `web.request`. | Partly built: notebook sources ("Add a website") are checked against the list. The Website access service and its handlers `web.read`, `web.lookup`, `web.link_out` and `web.request` are open |
| SIT-6 | The catalogue replaces `WEBSITE_SOURCE_DOMAINS`. Every step is audited (`site.requested`, `site.approved`, `site.rejected`, `site.revoked`, `site.paused`). | Partly built: `SITES_ENFORCE` (decided 2026-11-20: off at first, so an unapproved site is still added, flagged and asked for; "on" refuses it with "Ask to add this site"). Audited in `site_audit`: requested, approved, rejected, paused, resumed, revoked, switched off, added. `WEBSITE_SOURCE_DOMAINS` still applies until the catalogue replaces it |

## Modelling a website's actions (design time)

| ID | Requirement | Status |
|---|---|---|
| WEB-1 | An optional Website step in the Service Designer (Service → Website → Roles → Journeys → Review) drafts services from the forms on an approved site the business owns or may use. Anjal never submits forms on third-party sites for a visitor. | Parked |
| WEB-2 | Capture goes only to the approved origins, through the guarded gateway, into an archive (HAR). Analysis replays the archive in a fresh sandbox with networking off, and only structured findings and screenshots leave it. | Parked |
| WEB-3 | Each drafted action is delivered by a hand-over to staff (the default), a connector, or a link out. | Parked |
| WEB-4 | The archive and screenshots are removed when the service is published, or after 30 days for an abandoned draft. A weekly re-check marks the service for review when the form changes. | Parked |
| WEB-30 | Read-only run-time lookups (a bill or a status on a public page) are allowed only for platform-catalogue entries with a recorded recipe and a terms check. They are built with the Playwright capture and sandbox (WEB-1..4), not on their own. | Parked |
| WEB-31 | The lookup types only the given number and reads only the result. It never signs in, pays, solves a CAPTCHA or keeps cookies, and a CAPTCHA or OTP hands the page to the person. | Parked |
| WEB-32 | It runs in the same sandbox with network access to that one origin only, and its result must match a fixed schema. | Parked |
| WEB-33 | It runs at most once a day per number, with the result cached. A broken recipe is paused and reported, not retried. | Parked |
| WEB-34 | It runs on the household's or business's box when there is one, otherwise on the platform's lookup service, and the consent form says which. | Parked |
| WEB-35 | An official API (such as BBPS) is always preferred. | Parked |

## Order of work

1. MED-1..3, MED-4 (photo), MED-5, MED-10. Gate: a repair report with a photo runs offline at the front desk, and the photo reaches staff through the box.
2. MED-6..9, 11..12. Gate: the AI designer drafts the part-quote service from one sentence, with a correct consent form.
3. CNX-1..3 and 5..8, then SIT. Gate: a journey reads and writes a Google Sheet, and the secret never reaches a browser.
4. ATT. Gate: one business runs attendance on Anjal for a month.
5. RTN-1..9 and 11..13. Gate: the Monday summary and a late check-in alert run for a month with no wrong sends.
6. CNX-4, DEP.
7. Parked: FACE, RTN-10, WEB.
