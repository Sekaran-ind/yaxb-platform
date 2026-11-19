# 10 Platforms

## Web kiosk

| ID | Requirement | Status |
|---|---|---|
| PLT-1 | The kiosk must run in current Chrome, Edge, Safari and Firefox, as one Cloudflare Workers deployment serving the app and its API. | Built |
| PLT-2 | On-device models must run in Web Workers so the screen stays responsive, and be cached by the browser after their first download. | Built |
| PLT-3 | The server bundle must stay small (under about 1.5 MB compressed); on-device model data must not be bundled into it. | Built |

## Native app

| ID | Requirement | Status |
|---|---|---|
| PLT-10 | The kiosk must be packaged as a native Android and iOS app with Capacitor, from the same Vue app, following clinux-diary's setup (`apps/native`). The app is the kiosk alone: it opens straight into the kiosk, with Settings, and has no website, moderator or administration pages. | Built (not yet built on a device) |
| PLT-11 | The app must talk to the organisation's kiosk server for the agent and moderation (its address set at build time), and keep notebooks, profiles and on-device models on the device as the web kiosk does. The server address is `VITE_API_BASE`. | Built |
| PLT-12 | The app must use the device's microphone and speech where the web APIs aren't available in the app's web view, asking for permission with a clear reason. The app uses the device's speech recognition and text-to-speech through Capacitor plugins; the permission texts are in the Android manifest and Info.plist. | Built (not yet tried on a device) |
| PLT-13 | The app should support a kiosk (single-app) mode on Android tablets. | Proposed |
| PLT-14 | The server must accept the app's requests (its origin) with the same session, rate-limit and validation rules as the web kiosk. Only the origins in `KIOSK_APP_ORIGINS` (default `capacitor://localhost,https://localhost`) get CORS; the app sends its session id (a UUID kept on the device) in `X-Yaxb-Session` instead of a cookie, and the server accepts that header only from those origins. | Built |

## Command line

| ID | Requirement | Status |
|---|---|---|
| PLT-20 | `yaxb ask` and `yaxb chat` must run the same agent from a terminal, with provider keys from the environment, conversations saved locally or on a local box. | Built |

## Local box

| ID | Requirement | Status |
|---|---|---|
| PLT-30 | yaxb-box must store notebooks, conversations and memory on a Raspberry Pi on the local network (SQLite, replicated by Litestream), installable with one command. | Built |

## Voice device

| ID | Requirement | Status |
|---|---|---|
| PLT-40 | An ESP32-S3 voice device is planned; see `apps/esp32-s3-audio` for the design notes. | Planned (design only) |

## Surfaces: Anjal Family and Anjal for Business

| ID | Requirement | Status |
|---|---|---|
| SUR-1 | Each edition keeps its own database: Anjal Family (anjal-family), Anjal for Business (anjal-business) and Anjal Community (anjal-community), on yaxb-core and yaxb-journeys; the combined site keeps yaxb. | Built: since SUR-14, one Worker binds all of them. |
| SUR-2 | Each surface has its own home page: Family's story, ideas for families and children; Business's story, from an idea to a running service, and ideas for services. | Built |
| SUR-3 | Family offers Ask Me, notebooks, the Scheduler, Quick tools, profiles and the child safety lock; Business offers the kiosk and its front desk, the Service Catalogue and AI designer, requests, staff, join links and the directory, without the child lock or family profiles. | Built |
| SUR-4 | What a surface offers is yaxb-core's context (after clinux-core's resolveContext: surface, tenant, jurisdiction); the Worker answers 404 on routes for features its surface lacks. | Built |
| SUR-5 | "Realm" is kept for the regulatory context, as in ClinüxFlow (a jurisdiction's consent wording and what may be kept). | Planned |
| SUR-6 | The packages work in a project outside the monorepo from their packed tarballs, through their public exports only. | Built |
| SUR-7 | The combined site is the Yaxb.ai portal (yaxb.ai): Yaxb.ai's name, title and description, and a home page that leads to each platform. | Built |
| SUR-8 | The portal offers three platforms, each on its own site: Personal & Community (Anjal Family), Small Business (Anjal for Business) and Enterprise (ClinüxFlow, clinux.yaxb.ai). "Which fits you?" highlights one, and each card opens its platform. Their addresses are set when the portal is built (`VITE_FAMILY_URL`, `VITE_BUSINESS_URL`, `VITE_ENTERPRISE_URL`). | Built |
| SUR-9 | The portal shows the one core every platform shares, what every platform does, and how data is kept; each address has its own page title and description. | Built: the Worker writes each address's title and description into the one page (SUR-14). |
| SUR-10 | The Android and iOS app is named Anjal.ai (its app id stays `ai.yaxb.kiosk`, so installed apps update in place). | Built |
| SUR-11 | A third surface, Anjal Community (`anjal-community`), with its own database (EDN-2, EDN-3). | Built |
| SUR-12 | The editions are served at `family.anjalai.cc`, `business.anjalai.cc` and `community.anjalai.cc`, declared in the wrangler file (DOM-1). | Built |
| SUR-13 | The Worker also binds the shared platform database (PLA-1). | Built |
| SUR-14 | One address for every edition (decided 2026-11-19): one Worker and one build serve anjalai.cc, family., business., community.anjalai.cc and yaxb.ai. Each request acts in one edition: the open space's (its membership checked), else the address's, else the combined site. The edition chooses the sections and the database; nothing is read through another edition's database or cache. Switching space stays on the same address. Each address keeps its home page, title and description. | Built: `worker/edition.ts` (`editionContext`, `dbFor`, caches keyed by edition and tenant, tested in `worker/test/editions.test.ts`), yaxb-core context `surfaceOfHost`, `chooseSurface`, `SURFACE_HEADS`; `anj_space` names the edition (`business:<tenant>`); join links are looked up in the edition that issued them; the team's relay is per edition (`hubName`). The front end reads the edition from the page (`yaxb-edition`) or the host. Retiring the anjal-family, anjal-business and anjal-community Workers waits for the owner. |
