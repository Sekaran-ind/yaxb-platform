# 15 Identity and sign-in

Today Anjal identifies people in about ten separate ways: a visitor session cookie, the native app's session header, device profiles, member keys, the shared moderator token, the administrator token, join links, the box's bearer token, the CLI's `.env` and front-desk PINs. None of them is OAuth, OIDC, a passkey or an OTP, and a person can't carry one identity across editions, devices or businesses.

This spec adds one account per person, behind their profile, with the sign-in methods each service needs. It is a built-in system service, like Website access (SIT-5).

Source: *Anjal Identity and Sign-in Service* (2026-11-16), reviewed on 2026-11-18. Accounts live in the platform database (PLA-2), and the session works across `*.anjalai.cc` (DOM-2, DOM-3).

## Profile, account and memberships

| ID | Requirement | Status |
|---|---|---|
| IDN-1 | The profile stays the person's own space: preferences, sealed on the device (PRF). Behind it, optionally, sits an account: a person id and its linked sign-in methods, in the platform database. | Partly built: accounts in the platform database (yaxb-core `./identity`, platform migration 0002), behind Preferences → Account. Linking the device profile's own record to the account (so it can move with its passphrase, IDN-4) is open. |
| IDN-2 | Linking a profile to an account is the person's choice ("Keep my things across devices"). A profile may stay local and anonymous, as today. | Built: an account is made only from Preferences → Account, after the notice; profiles work without one. |
| IDN-3 | One account has memberships: for each family, business or community, on any edition, the roles held there. The person switches between them from the profile without signing in again. | Built: memberships per edition and tenant, with roles and the member they stand for; switching opens the space without signing in again. |
| IDN-4 | The account never holds the profile's passphrase or contents. Moving a profile to a new device needs the passphrase (or a recovery key protected by a passkey) as well as the sign-in. | Built (as a rule): the account keeps no passphrase or profile contents. |
| IDN-5 | A child's profile links to a guardian's account. A child does not sign in with outside providers. | Partly built: the Account section is hidden while the child lock is on. A child profile linked to a guardian's account is open. |
| IDN-6 | An account is not required: visitors and Kiosk-only use stay anonymous unless a service needs more (IDN-30). | Built: visitors and Kiosk-only use need no account. |

## Spaces: choosing where you are

A **space** is one place a person belongs to: their family, a business they work in, a community they are part of. Each space is a tenant of one edition (Family, Business or Community). Today the edition is chosen by which website is opened; with spaces, the person chooses in the kiosk and the Service Catalogue, and the space decides which sections load. The word on screen is the space's own name ("Our home", "Sri Ram Hardware", "Lake View Apartments"), never "realm", "edition" or "tenant".

| ID | Requirement | Status |
|---|---|---|
| SPC-1 | A space is a tenant of an edition, with a name, a kind (family, business or community) and the person's roles there (a membership, IDN-3). One account may hold memberships in any number of spaces, on any edition. | Built: `memberships` (edition, tenant, name, kind, roles, member). |
| SPC-2 | "Who's using Anjal?" asks for the person first (their profile), then, when they belong to more than one space, which space. A person with one space goes straight in. The last space chosen on this device is offered first. | Built: "Where are you today?" (`SpacePicker.vue`) follows "Who's using Anjal?" when the account has several spaces here and none is open; the your-account journey offers it too. |
| SPC-3 | The open space's kind decides the sections, with the same rules each edition applies today (`offers`: household requests in a family; the catalogue, requests, staff and the front desk in a business or community; profiles and the child lock in a family or community). On the combined site and in the native app this is read from the open space while the app runs, not fixed at build time. Every address offers every space (SUR-14). | Built: the sections follow the open space's kind on every address (`lib/surface.ts`), and a space of any edition opens where the person is: the Worker reads that edition's database (SUR-14). |
| SPC-4 | The person switches space from the player's profile button, without signing in again. The conversation, the notebooks shown, the loaded services, requests and the team all switch with it. Nothing from one space is shown, sent or kept in another. | Built: the player's Account button (Business) or space button (with profiles) opens the picker; switching restarts the app in the space, and a journey in progress finishes in its conversation. |
| SPC-5 | A space administrator can lock a device to one space (a shop's front desk, a society's lobby kiosk). A locked device offers no switching, and its visitors stay anonymous within that space (IDN-6). The lock is part of Front desk setup and is undone only by that space's administrator. | Built: Preferences → Front desk → "Keep this device for this space" (the space's administrator: their member key, their account's membership, or the administrator token). The device holds an HttpOnly `anj_lock` (`<id>.<secret>`; platform migration 0004 keeps only the secret's keyed hash). Every request on it acts in that space's edition and tenant, the account's other spaces are ignored, opening or starting another space answers 409, and pages show that space's sections. Released here or from the space's list of kept devices; a release holds everywhere within a minute. |
| SPC-6 | Without an account nothing changes: a local profile works in this device's one space, as today. Linking the profile to an account (IDN-2) brings its memberships. | Built: without an account nothing changes. |
| SPC-7 | The server decides, not the browser: every call names its space, and the Worker serves a space's data only when the account session holds a membership there (or the device is locked to it). The tenant context comes from the session and that check, not from a cookie the browser chose (PLA-4). | Built: `anj_space` is checked against the account's memberships on every request before the tenant context uses it; a membership linked to a member signs that member in; closing the space makes the browser a guest again. |
| SPC-8 | A person can start a space ("Start a family", "Start a business", "Start a community") from an organisation template (ORG-2) and becomes its administrator, or join one through a join link (IDN-40), which ends in a membership. | Built: "Start a new space" (a new tenant with the person as its administrator, at most five a day) and "Join one with a code" (a join link ends in a membership: at once, or once the administrator accepts, collected by itself on the next visit; the claim is sealed in `pending_joins`, platform migration 0003). Starting from an organisation template is open. |
| SPC-9 | A child's profile sees only the family spaces its guardian has added it to, never a business space, and cannot start or join one (IDN-5, CHL). | Planned |
| SPC-10 | Audit, facts only: `space.created`, `membership.added`, `membership.removed`, `device.locked`, `device.unlocked`. Switching space is not audited (it says nothing a session doesn't). | Built: space, membership and device actions are audited (`device.locked`, `device.unlocked`); switching is not. |

## Sign-in methods

| ID | Requirement | Status |
|---|---|---|
| IDN-10 | Passkeys (WebAuthn, relying party `anjalai.cc`) are the recommended default. The box can check a passkey offline against the stored public key. | Built: SimpleWebAuthn, discoverable passkeys, relying party `anjalai.cc` (`localhost` locally); a passkey made on one edition signs in on every other. Tested with real responses (a software authenticator) and in Chromium with a virtual authenticator. |
| IDN-11 | Phone OTP (SMS or WhatsApp) through a provider connector, with attempts capped per number. It is never the only factor for high-value actions, because of SIM swaps. Commercial SMS in India requires DLT registration of the sender and templates. Moved to a later release (decided 2026-11-19): the first release signs in with passkeys and Google, and needs no SMS provider. | Partly built: the core's phone sign-in (codes as keyed hashes, masked numbers, attempt and send caps) waits for a provider; it is not offered. |
| IDN-12 | Email OTP or a magic link. | Planned |
| IDN-13 | Passwords only where a business insists: always with a second factor for staff, a slow hash, and a check against known-breached passwords. | Planned |
| IDN-14 | Google, Microsoft and Apple through OIDC with PKCE, state and nonce. Anjal keeps only the provider's subject id and verified email. | Partly built: Google, with PKCE, state and nonce (oauth4webapi); only the subject id's keyed hash and the masked email are kept. Offered once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Microsoft and Apple come with step 5. |
| IDN-15 | A business's own OIDC provider (Entra ID, Google Workspace, Okta, Keycloak), configured per tenant. The client secret stays on the server, and leaving the company ends access within the session length. | Planned |
| IDN-16 | Member keys become a sign-in method of an account, for machines, routines and integrations, with scopes and an expiry. Existing members keep working. | Planned |
| IDN-17 | Personal access tokens for the CLI and scripts: scoped, expiring, revocable, issued through device sign-in (IDN-41). | Planned |
| IDN-18 | Device credentials, one per device, each revocable on its own, for box clients, kiosks and the voice device. | Planned |
| IDN-21 | Recovery codes: ten one-time codes, shown once when the account is made (and again on request, replacing the old ones), kept only as hashes. Each signs in once at level 1, enough to add a new method. | Built: ten codes as keyed hashes, shown once; each signs in once at level 1. |
| IDN-19 | QR hand-off: someone signs in on a kiosk or shared tablet by scanning with a phone that is already signed in, and the kiosk gets a short session. A password is never typed on a public screen. | Planned |
| IDN-20 | Aadhaar authentication is never used. Document providers such as DigiLocker may be added later through the OIDC slot for level 4 (IDN-30). | Planned (as a rule) |

## Assurance levels

| ID | Requirement | Status |
|---|---|---|
| IDN-30 | A service states how sure it must be of who someone is, not how to check it. Levels: 0 anonymous; 1 a returning person; 2 a verified contact (OTP, or OIDC with a verified email); 3 a strong sign-in (a passkey, or two factors); 4 a verified real-world identity (regulated services, mostly Clinux). | Planned |
| IDN-31 | Handlers: `identity.require` (pause until signed in at a level), `identity.step_up` (ask for a stronger method now), `identity.whoami` (display name, memberships and roles here; never contact details unless the consent form allows) and `identity.verify_contact` (verify a phone or email for this service only). | Planned |
| IDN-32 | A journey signed in below the level a step needs pauses on a step-up screen and resumes where it was. An anonymous visitor can start a level-0 part and sign in only when a step needs it. | Planned |
| IDN-33 | The Service Designer's "Who can use this" sets the starting level, the level for each step that needs more, and the methods accepted from those the tenant allows. Designers never write sign-in logic or handle tokens in YAML. | Planned |
| IDN-34 | A tenant administrator chooses the methods allowed, the business's own OIDC provider, whether staff must use passkeys or two factors, and session lengths. | Planned |

## The service's journeys

| ID | Requirement | Status |
|---|---|---|
| IDN-40 | Built-in journeys: sign up or sign in; join a family, business or community (today's join links, ending in a membership rather than a key); link or remove a method (at least one recovery route is required); approve a sign-in; manage devices and sessions (sign out one or everywhere); recover my account (a second method, a trusted contact for elders, or a tenant administrator for staff); delete my account. | Partly built: the your-account journey (`content/journeys/your-account.journey.yaml`) signs in or makes an account, then opens, starts or joins a space, one step at a time in the conversation; Preferences → Account has the rest (methods, recovery codes, sessions, delete). Recovery through a trusted contact or an administrator, and approving a sign-in, are open. |
| IDN-41 | The CLI signs in with `yaxb login`, which shows a code and a QR for the person to approve on their phone. Tokens are kept in the OS keychain or a file only the user can read, replacing provider keys and the box token in `~/.yaxb/.env`. `yaxb logout` revokes them. | Planned |
| IDN-42 | The box replaces its single bearer token with per-device credentials issued at sign-in, which it can verify offline, plus a revocation list synced from the server. People signed in recently keep working when the internet is down. | Planned |
| IDN-43 | The native app signs in with OIDC in the system browser (never an embedded web view), returning by app link with PKCE. Sessions are kept in the Keychain or Keystore and carried by `X-Yaxb-Session`. | Planned |
| IDN-44 | `MODERATOR_TOKEN` is retired once every member signs in with an account. `ADMIN_TOKEN` stays only for break-glass use. | Planned |

## Security, privacy and audit

| ID | Requirement | Status |
|---|---|---|
| IDN-50 | Short sessions and rotating refresh tokens. Tokens and keys are stored only as hashes. Signing keys rotate and are published as a JWKS, so every edition's Worker and the box can verify a session. | Built: ES256 access tokens (15 minutes) signed by rotating keys sealed with `IDENTITY_SECRET`, published at `/api/identity/jwks`; refresh tokens rotate on every use and a reused one ends the session. The box's offline check comes with IDN-42. |
| IDN-51 | Rate limits and lockout on every method. The existing same-origin, CSRF and "never log content" rules apply unchanged. | Built: limits per address on every method, per-challenge attempt caps, one-use challenges; same-origin checks on every change. |
| IDN-52 | Keep the least: a provider's subject id, a verified email or phone, passkey public keys. Phone numbers are masked on screen. Sign-up shows a consent notice. Deleting an account erases what the law allows. | Built: keyed hashes and masked forms only, the consent notice before an account is made, deletion of methods, sessions and spaces. |
| IDN-53 | Audit, facts only: `account.created`, `signed_in` (method and level), `sign_in.failed` (counts), `step_up`, `method.linked`, `method.removed`, `session.revoked`, `token.issued`, `token.revoked`, `recovery.used`, `account.deleted`. | Built: `identity_audit` in the platform database, facts only (`account.created`, `signed_in` with method and level, `sign_in.failed`, `session.revoked`, `method.linked`, `method.removed`, `recovery.used`, `account.deleted`, `space.created`, `membership.added`, `membership.removed`). |
| IDN-54 | A proven library does the protocol work (PKCE, WebAuthn verification, token rotation). Anjal's own code is the service, the profile link, assurance levels and the surfaces. Chosen (2026-11-19): SimpleWebAuthn for passkeys and oauth4webapi for OIDC; sessions and keys on Web Crypto in yaxb-core `./identity`. | Built: SimpleWebAuthn (passkeys) and oauth4webapi (OIDC); sessions and keys on Web Crypto. |
| IDN-55 | Clinux's sign-in journeys become clients of this service. ABHA and HPR sign-in plug in as Clinux realm methods at level 4. | Proposed |

## Order of work

1. IDN-1..6, 10, 14 (Google), 21 and 50..54, with SPC-1..4, 6, 7 and 10. No SMS provider is needed. Gate: one person uses the same account on two editions, the web and a second phone, with a family and a business membership, switching between the two spaces without signing in again, and neither space's data shows in the other.
2. IDN-16, 40 and 44, with SPC-5, 8 and 9. Gate: every member signs in with a passkey or OTP, and keys remain only for machines; a front-desk kiosk locked to its space offers no switching.
3. IDN-30..34. Gate: a hall booking starts at level 2 and its approval step steps up to level 3, resuming where it paused.
4. IDN-17, 18, 41 and 42. Gate: `yaxb login` works with no secrets in `~/.yaxb/.env`, and one lost phone is revoked without touching any other device.
5. IDN-11..13, 15 (Microsoft, Apple and a business's own provider), 43. Gate: a business's staff sign in with their company accounts, and a number gets a code by SMS or WhatsApp.
6. IDN-19. Gate: a visitor signs in on a front-desk kiosk by scanning, with nothing typed on the kiosk.
