# 15 Identity and sign-in

Today Anjal identifies people in about ten separate ways: a visitor session cookie, the native app's session header, device profiles, member keys, the shared moderator token, the administrator token, join links, the box's bearer token, the CLI's `.env` and front-desk PINs. None of them is OAuth, OIDC, a passkey or an OTP, and a person can't carry one identity across editions, devices or businesses.

This spec adds one account per person, behind their profile, with the sign-in methods each service needs. It is a built-in system service, like Website access (SIT-5).

Source: *Anjal Identity and Sign-in Service* (2026-11-16), reviewed on 2026-11-18. Accounts live in the platform database (PLA-2), and the session works across `*.anjalai.cc` (DOM-2, DOM-3).

## Profile, account and memberships

| ID | Requirement | Status |
|---|---|---|
| IDN-1 | The profile stays the person's own space: preferences, sealed on the device (PRF). Behind it, optionally, sits an account: a person id and its linked sign-in methods, in the platform database. | Planned |
| IDN-2 | Linking a profile to an account is the person's choice ("Keep my things across devices"). A profile may stay local and anonymous, as today. | Planned |
| IDN-3 | One account has memberships: for each family, business or community, on any edition, the roles held there. The person switches between them from the profile without signing in again. | Planned |
| IDN-4 | The account never holds the profile's passphrase or contents. Moving a profile to a new device needs the passphrase (or a recovery key protected by a passkey) as well as the sign-in. | Planned |
| IDN-5 | A child's profile links to a guardian's account. A child does not sign in with outside providers. | Planned |
| IDN-6 | An account is not required: visitors and Kiosk-only use stay anonymous unless a service needs more (IDN-30). | Planned |

## Spaces: choosing where you are

A **space** is one place a person belongs to: their family, a business they work in, a community they are part of. Each space is a tenant of one edition (Family, Business or Community). Today the edition is chosen by which website is opened; with spaces, the person chooses in the kiosk and the Service Catalogue, and the space decides which sections load. The word on screen is the space's own name ("Our home", "Sri Ram Hardware", "Lake View Apartments"), never "realm", "edition" or "tenant".

| ID | Requirement | Status |
|---|---|---|
| SPC-1 | A space is a tenant of an edition, with a name, a kind (family, business or community) and the person's roles there (a membership, IDN-3). One account may hold memberships in any number of spaces, on any edition. | Planned |
| SPC-2 | "Who's using Anjal?" asks for the person first (their profile), then, when they belong to more than one space, which space. A person with one space goes straight in. The last space chosen on this device is offered first. | Planned |
| SPC-3 | The open space's kind decides the sections, with the same rules each edition applies today (`offers`: household requests in a family; the catalogue, requests, staff and the front desk in a business or community; profiles and the child lock in a family or community). On the combined site and in the native app this is read from the open space while the app runs, not fixed at build time. An edition's own site offers only spaces of its kind. | Planned |
| SPC-4 | The person switches space from the player's profile button, without signing in again. The conversation, the notebooks shown, the loaded services, requests and the team all switch with it. Nothing from one space is shown, sent or kept in another. | Planned |
| SPC-5 | A space administrator can lock a device to one space (a shop's front desk, a society's lobby kiosk). A locked device offers no switching, and its visitors stay anonymous within that space (IDN-6). The lock is part of Front desk setup and is undone only by that space's administrator. | Planned |
| SPC-6 | Without an account nothing changes: a local profile works in this device's one space, as today. Linking the profile to an account (IDN-2) brings its memberships. | Planned |
| SPC-7 | The server decides, not the browser: every call names its space, and the Worker serves a space's data only when the account session holds a membership there (or the device is locked to it). The tenant context comes from the session and that check, not from a cookie the browser chose (PLA-4). | Planned |
| SPC-8 | A person can start a space ("Start a family", "Start a business", "Start a community") from an organisation template (ORG-2) and becomes its administrator, or join one through a join link (IDN-40), which ends in a membership. | Planned |
| SPC-9 | A child's profile sees only the family spaces its guardian has added it to, never a business space, and cannot start or join one (IDN-5, CHL). | Planned |
| SPC-10 | Audit, facts only: `space.created`, `membership.added`, `membership.removed`, `device.locked`, `device.unlocked`. Switching space is not audited (it says nothing a session doesn't). | Planned |

## Sign-in methods

| ID | Requirement | Status |
|---|---|---|
| IDN-10 | Passkeys (WebAuthn, relying party `anjalai.cc`) are the recommended default. The box can check a passkey offline against the stored public key. | Planned |
| IDN-11 | Phone OTP (SMS or WhatsApp) through a provider connector, with attempts capped per number. It is never the only factor for high-value actions, because of SIM swaps. Commercial SMS in India requires DLT registration of the sender and templates. | Planned |
| IDN-12 | Email OTP or a magic link. | Planned |
| IDN-13 | Passwords only where a business insists: always with a second factor for staff, a slow hash, and a check against known-breached passwords. | Planned |
| IDN-14 | Google, Microsoft and Apple through OIDC with PKCE, state and nonce. Anjal keeps only the provider's subject id and verified email. | Planned |
| IDN-15 | A business's own OIDC provider (Entra ID, Google Workspace, Okta, Keycloak), configured per tenant. The client secret stays on the server, and leaving the company ends access within the session length. | Planned |
| IDN-16 | Member keys become a sign-in method of an account, for machines, routines and integrations, with scopes and an expiry. Existing members keep working. | Planned |
| IDN-17 | Personal access tokens for the CLI and scripts: scoped, expiring, revocable, issued through device sign-in (IDN-41). | Planned |
| IDN-18 | Device credentials, one per device, each revocable on its own, for box clients, kiosks and the voice device. | Planned |
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
| IDN-40 | Built-in journeys: sign up or sign in; join a family, business or community (today's join links, ending in a membership rather than a key); link or remove a method (at least one recovery route is required); approve a sign-in; manage devices and sessions (sign out one or everywhere); recover my account (a second method, a trusted contact for elders, or a tenant administrator for staff); delete my account. | Planned |
| IDN-41 | The CLI signs in with `yaxb login`, which shows a code and a QR for the person to approve on their phone. Tokens are kept in the OS keychain or a file only the user can read, replacing provider keys and the box token in `~/.yaxb/.env`. `yaxb logout` revokes them. | Planned |
| IDN-42 | The box replaces its single bearer token with per-device credentials issued at sign-in, which it can verify offline, plus a revocation list synced from the server. People signed in recently keep working when the internet is down. | Planned |
| IDN-43 | The native app signs in with OIDC in the system browser (never an embedded web view), returning by app link with PKCE. Sessions are kept in the Keychain or Keystore and carried by `X-Yaxb-Session`. | Planned |
| IDN-44 | `MODERATOR_TOKEN` is retired once every member signs in with an account. `ADMIN_TOKEN` stays only for break-glass use. | Planned |

## Security, privacy and audit

| ID | Requirement | Status |
|---|---|---|
| IDN-50 | Short sessions and rotating refresh tokens. Tokens and keys are stored only as hashes. Signing keys rotate and are published as a JWKS, so every edition's Worker and the box can verify a session. | Planned |
| IDN-51 | Rate limits and lockout on every method. The existing same-origin, CSRF and "never log content" rules apply unchanged. | Planned |
| IDN-52 | Keep the least: a provider's subject id, a verified email or phone, passkey public keys. Phone numbers are masked on screen. Sign-up shows a consent notice. Deleting an account erases what the law allows. | Planned |
| IDN-53 | Audit, facts only: `account.created`, `signed_in` (method and level), `sign_in.failed` (counts), `step_up`, `method.linked`, `method.removed`, `session.revoked`, `token.issued`, `token.revoked`, `recovery.used`, `account.deleted`. | Planned |
| IDN-54 | A proven library does the protocol work (PKCE, WebAuthn verification, token rotation). Anjal's own code is the service, the profile link, assurance levels and the surfaces. The library is chosen after a short trial on Workers with D1 (candidates: Better Auth, OpenAuth, or SimpleWebAuthn with oauth4webapi). | Planned |
| IDN-55 | Clinux's sign-in journeys become clients of this service. ABHA and HPR sign-in plug in as Clinux realm methods at level 4. | Proposed |

## Order of work

1. IDN-1..6, 10, 11 and 50..54, with SPC-1..4, 6, 7 and 10. Gate: one person uses the same account on two editions, the web and a second phone, with a family and a business membership, switching between the two spaces without signing in again, and neither space's data shows in the other.
2. IDN-16, 40 and 44, with SPC-5, 8 and 9. Gate: every member signs in with a passkey or OTP, and keys remain only for machines; a front-desk kiosk locked to its space offers no switching.
3. IDN-30..34. Gate: a hall booking starts at level 2 and its approval step steps up to level 3, resuming where it paused.
4. IDN-17, 18, 41 and 42. Gate: `yaxb login` works with no secrets in `~/.yaxb/.env`, and one lost phone is revoked without touching any other device.
5. IDN-12..15, 43. Gate: a business's staff sign in with their company accounts.
6. IDN-19. Gate: a visitor signs in on a front-desk kiosk by scanning, with nothing typed on the kiosk.
