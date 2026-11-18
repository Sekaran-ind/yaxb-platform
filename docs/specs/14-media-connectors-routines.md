# 14 Media, connectors, routines and websites

Photos, audio and video in services; attendance (FaceOps rebuilt on Anjal); connectors to a business's other systems; hooks and routines that act on events and schedules; dependencies between departments and businesses; and the approved websites Anjal may read.

Anjal's rule for text applies to all of it: process on the device first, then on the box, and use the cloud only when the plan and the person's consent allow it.

Source: *Anjal: Media, FaceOps, Connectors and Routines* (2026-11-16), reviewed on 2026-11-18. Features that need the paid plan or carry the highest risk are **Parked** until consent forms, licences and limits are in place.

## Media

| ID | Requirement | Status |
|---|---|---|
| MED-1 | Media is stored apart from records and referenced by content hash: IndexedDB on the device, files on the box, R2 on the server. Sync rows and case envelopes carry the hash, and a blob moves only when the receiver needs it. A case envelope never carries a photo inline. | Planned |
| MED-2 | A camera and microphone capture component in yaxb-journeys/vue, with preview, retake and size limits, used by the kiosk and the native app (Capacitor camera on a device). | Planned |
| MED-3 | Every media item has a text form stored beside it (transcript, OCR text, caption), so the agent, search and slot filling work on media unchanged, and a citation can point at a photo or a time in a clip. | Planned |
| MED-4 | New field types: `photo` (capture, max, read: ocr/caption/none, keep: device/box/server), `audio` (max_seconds, transcribe: device/server/none, keep), `video` (max_seconds, keep) and `file` (accept, keep). | Planned |
| MED-5 | Photos are read on the device first (Tesseract.js with Tamil and Hindi, or Florence-2). A cloud vision model is used only when the service allows it and the consent form says so. | Planned |
| MED-6 | New handlers, each saying whether data leaves the device: `media.transcribe`, `media.read` (OCR or caption), `media.extract` (fill named fields from a photo or document, checked like `kiosk.extract`) and `call.start` (a video call with the role that finishes the case). | Planned |
| MED-7 | The AI designer knows the new types and handlers, with one built-in example per pattern (photo report, voice note, document capture). The flow checks warn when a media field keeps data on the server but the service's storage is none or box. The preview's stand-ins return a sample transcript or OCR text. | Planned |
| MED-8 | The Legal Guardian counts media: a photo of a person and any voice recording raise the sensitivity, and the form says where media is kept and for how long (default 30 days for recordings). | Planned |
| MED-9 | Recorded audio is transcribed on the device (Whisper or Moonshine in a worker) or, when the service allows, by Workers AI. | Planned |
| MED-10 | Children's photos are never sent to a cloud model. The child lock turns off cameras and microphones for media fields. | Planned |
| MED-11 | Events: `media.captured`, `media.read`, `media.sent_to_model` with the provider's name. Never the media itself. | Planned |
| MED-12 | Every model's licence must be checked before it ships. | Planned |

## Attendance

FaceOps is rebuilt as an Attendance service on Anjal for Business, not ported. Most of it already exists: campaigns are tenants, employees are members, kiosk mode is Restricted Mode, and advance and leave requests are cases.

| ID | Requirement | Status |
|---|---|---|
| ATT-1 | A check-in journey with QR or PIN. Each check-in is an event with an outcome (in, out, late). | Planned |
| ATT-2 | Departments and shifts are synced service data on the business's box (SYN). | Planned |
| ATT-3 | A roster view over the events, weekly and monthly, beside the service dashboard. | Planned |
| ATT-4 | A grid view where a manager edits the roster like a spreadsheet, with export to CSV. | Planned |
| ATT-5 | A one-time import of Airtable's CSV export (employees, departments, shifts) into the box. No Airtable account stays in the loop. | Planned |
| ATT-6 | An optional location check with a geofence per site, storing only "inside site X" (VIS-8). | Planned |
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
| CNX-2 | A `kind: connector` document describes a plain REST API declaratively: a base address, the auth, and named operations. Each operation becomes a journey handler `connector.<id>.<operation>`. | Planned |
| CNX-3 | Connector secrets are stored per tenant on the server, or on the box for box connectors, and are referenced only by name in YAML. A secret never reaches a browser. | Planned |
| CNX-4 | Box connectors reach systems on the office network (Tally first, then printers and devices). | Planned |
| CNX-5 | Every outbound address passes the SSRF guard (SEC-4). Results are wrapped as untrusted data. | Planned |
| CNX-6 | The journey compiler checks connector handler names like built-in ones, so a typo fails at publish time. | Planned |
| CNX-7 | The Legal Guardian counts connectors as places data goes. | Planned |
| CNX-8 | Connectors are reviewed and published through the Service Catalogue. Audit: `connector.created`, `connector.secret_rotated`, `connector.removed`. Events: `connector.called` (operation, success, duration), never the payload. | Planned |

## Hooks and routines

| ID | Requirement | Status |
|---|---|---|
| RTN-1 | A `kind: routine` document holds a trigger (schedule, event, webhook or date), a condition (the existing expression language) and actions: start a journey or case, call a connector, message a role, run the agent with a restricted tool list, or record an event. | Planned |
| RTN-2 | Schedules run on Cron Triggers with one Durable Object alarm per tenant, and on the box when offline. | Planned |
| RTN-3 | A new routine first runs as a dry run with the stand-in handlers and shows what it would have done. | Planned |
| RTN-4 | Every run is logged as events (started, each action, finished, failed), so the dashboard shows routines beside journeys. | Planned |
| RTN-5 | Per-tenant limits on runs per day, model spend and messages sent, with a switch that pauses every routine. | Planned |
| RTN-6 | An action that sends outside the business (a message, an email, a connector write) can require a person's approval, which is a case for that role. | Planned |
| RTN-7 | Only administrators, or a new `automator` role, may publish routines, and a reviewer approves them like services. | Planned |
| RTN-8 | Notify hooks run after the fact on the existing event kinds, with declarative actions or a signed outgoing webhook. | Planned |
| RTN-9 | Guard hooks may stop a step with a reason the person sees, using a safe condition or a yes-or-no connector call within a time limit. | Planned |
| RTN-10 | Transform hooks run sandboxed code (an isolate per tenant), with no network except named connectors and with strict limits. | Parked |
| RTN-11 | What a guard or transform returns is stored with the case, so replaying the case never calls the hook again. | Planned |
| RTN-12 | Families get ready-made routines from a list of switches, with no YAML. A family routine never messages anyone outside the family without a parent's approval. Transform hooks are not offered in Family or Community. | Planned |
| RTN-13 | Nothing pays automatically. | Planned (as a rule) |

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
| SIT-1 | Every outside site Anjal reads, analyses or looks things up on comes from an approved list. There are two tiers: the platform catalogue (kept in the platform database, PLA-2, by the platform's moderators, per country and state, used by every edition) and each tenant's own list. | Planned |
| SIT-2 | An entry records its origin and paths, region, category, uses allowed (notebook source, link out, design-time analysis, run-time lookup), the approving moderator, a review date and, for lookups, the recipe and its last good check. Requester and approver are different people. | Planned |
| SIT-3 | A tenant can switch platform entries off but cannot loosen them. A third-party site is used for run-time lookups only through the platform catalogue. Families use only the platform catalogue. | Planned |
| SIT-4 | "Ask to add this site" opens a case in the platform moderators' My work queue, with the address, the use wanted and the reason. It names the tenant (or "a family") and never the person or their consumer numbers. Requests for the same site are merged, with a count. | Planned |
| SIT-5 | Website access is a built-in system service in every catalogue (switchable, not deletable), with journeys (add a website to my notebook, check a bill or status, analyse our website, ask to add a site, review a site request) and handlers `web.read`, `web.lookup`, `web.link_out` and `web.request`. | Planned |
| SIT-6 | The catalogue replaces `WEBSITE_SOURCE_DOMAINS`. Every step is audited (`site.requested`, `site.approved`, `site.rejected`, `site.revoked`, `site.paused`). | Planned |

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
