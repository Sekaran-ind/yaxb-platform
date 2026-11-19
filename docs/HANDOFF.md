# Hand-over: where things stand

Last updated 2026-11-19, at the end of Wave 1. Read this with `CLAUDE.md` (how the code is built) and `docs/specs/` (every requirement and its status). Together they replace the notes a previous Claude session kept outside the repo.

## Wave 1 is complete and live

Merged as PRs #15 to #30, and deployed on 2026-11-19:

| Site | Worker | D1 |
|---|---|---|
| https://family.anjalai.cc | anjal-family | anjal-family |
| https://business.anjalai.cc | anjal-business | anjal-business |
| https://community.anjalai.cc | anjal-community | anjal-community |
| https://yaxb.ai and https://anjalai.cc (the portal; both mapped in the Cloudflare dashboard) | yaxb-web | yaxb |

Every Worker also binds `PLATFORM_DB` (anjal-platform). The database ids are in the wrangler files. All migrations are applied remotely, up to `0015_audit_chain.sql` and the platform database's `0001_platform.sql`.

What Wave 1 added, and its requirement ids:
- the specs for the planned features (12 to 16), and TEAM-52;
- spell check (SPL-1..7, 10);
- the player (PLY-1..6);
- conversations keep their context and are compacted (ANS-45..46), and the designer as a chat thread (LIB-63);
- the ethics check without a model (ETH-1, 4), and the audit hash chain (AUD-2..3);
- the storage meter (STO-1..3) and household requests in Family (EDN-20..24);
- the Community edition, the platform database and the anjalai.cc domains (EDN-1..5, PLA-1, PLA-5, DOM-1);
- the Family and Community home pages with their own moods, the Anjalai brand and mascot.

## Wave 2 so far

- PR #32: the organisation design (ORG-1..5, 8, 9). Edition migration `0016_organisation.sql`.
- PR #33: the catalogue's player holds its controls; a new service is designed in Ask Me (LIB-64).
- Identity step 1 with spaces (IDN-1..6, 10, 14, 21, 50..54; SPC-1..4, 6, 7, 10): passkeys, Google and recovery codes; SMS, WhatsApp and email codes wait for a later release (decided 2026-11-19). Platform migration `0002_identity.sql`.

Before deploying identity:
1. One `IDENTITY_SECRET` (32+ characters), **the same on every Worker** (the portal and the three editions): `npx wrangler secret put IDENTITY_SECRET -c wrangler.<edition>.jsonc`, and without `-c` for the portal. Changing it signs everyone out and makes the stored signing keys unreadable.
2. For Google: a Google Cloud project → APIs & Services → OAuth consent screen (external, the app's name and the support email), then Credentials → OAuth client ID → Web application, with an authorised redirect URI per site: `https://family.anjalai.cc/api/identity/google/callback`, the same for business, community and anjalai.cc. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on every Worker. Without them, Google isn't offered.
3. The platform migration is applied by each edition's deploy script.

Running the editions side by side locally: `apps/web/.env.development.local` points the portal's links at `localhost:3001` (Business), `3002` (Family) and `3003` (Community); start one with `npx vite --mode business --port 3001` in `apps/web`. Cookies are shared across ports, so one sign-in covers them all, like `.anjalai.cc` does live.

## Wave 2: where to start

Each spec file ends with an "Order of work". Requirements still Planned or Partly built:
- **Identity** (`15-identity.md`) and the **email assistant** (`16-email-assistant.md`). Both use the platform database.
- **Media, connectors and routines** (`14-media-connectors-routines.md`). Reading bills from billers' pages (BIL-3, WEB-30) is parked and will be built as part of the Playwright work.
- **Editions** (`12-platform-and-editions.md`):
  - EDN-6..10 (committees, elections, notices to members);
  - children and elders (EDN-30..35);
  - households across several devices (EDN-20 works on one shared device today).
- **Foundations** (`13-foundations.md`):
  - SPL-8..9; ETH-2..3 and ETH-5's published rules; AUD-1, 4..6 and the box's daily chain check;
  - STO-4..9, RET, VIS, ORG, VOC, FAQ, SNB.
- **The vocabulary tool** (SPL-11..14) is to be built separately, as the owner decided. Its general word list per language needs the owner's choice of an openly licensed source.

## How the owner likes to work

- **Momentum over questions.** Pick sensible defaults, carry on, and list the choices in the summary.
- **One PR per item.** For a wave the owner has started, merge each PR once its Android (`apk`) check passes, then go on to the next item.
- **Deploying needs the owner's go-ahead each time.** Creating Cloudflare resources too.
- **Ask before adding a dependency.**
- **Check UI changes with Playwright screenshots:** desktop 1440, tablet 1024 and phone 390, in the light and dark themes. Install Playwright in a scratch folder, not in the repo.
- **Brand:** the brand is **Anjalai**, with "ai" in the accent gradient (`BrandText.vue`), and the mascot is `AnjalaiCharacter.vue`. The kiosk still calls itself "Anjal" when it speaks. The operator is Yaxb Technology Solutions Private Limited, helpdesk@yaxb.ai.
- **Writing:** plain words in specs and UI copy. Facts with sources, never advice.

## Setting up another laptop

1. Clone the repo, then run `node yaxb.mjs start`. The first run installs everything, creates `apps/web/.dev.vars` with fresh local secrets, and migrates the local databases.
2. Copy the provider and search keys into `apps/web/.dev.vars` from the old laptop, privately (not through git): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `TAVILY_API_KEY`, and any model keys. Chat needs at least one.
3. Run `npx wrangler login` in `apps/web` before deploying.
4. **The administrator tokens of the live sites are not in the repo.** Community's is in `.run/anjal-community-admin-token.txt` on the old laptop. Keep all of them in a password manager. A lost token is replaced with `npx wrangler secret put ADMIN_TOKEN -c wrangler.<edition>.jsonc`.
5. Optional: copy the old Claude memory folder, `~/.claude/projects/<project path>/memory/`, into the new laptop's matching folder. Nothing in it is needed beyond this file.

## Deploying

From `apps/web`: `npm run deploy:family`, `npm run deploy:business` and `npm run deploy:community`. Then, from the repo root, `node yaxb.mjs deploy` for the portal. Each one applies its database's migrations and the platform database's, then builds and deploys. Build right before each deploy: wrangler follows the last build.

## Windows gotchas on the first laptop

- **Run the core's vitest from PowerShell** with an upper-case `C:` path. From Git Bash's `/c/` path, every test file fails with "reading 'config'".
- **Stop local servers with `node yaxb.mjs stop`.** Stopping a background wrangler or vite only kills the wrapper, and its workerd and esbuild children keep running.
- **PowerShell 5.1** writes files with a byte-order mark. Strip it from JSON files.
- **Vite in dev** may load a module twice, under a `?t=` URL, after a hot update.
- **Rebuilding yaxb-core (or yaxb-journeys) while a dev server runs** can leave its Worker broken ("Internal Server Error: Cannot convert undefined or null to object" from `runner-worker`): the Worker reloaded while `dist/` was half written. Restart that server (`node yaxb.mjs restart`, or stop and start the edition's `vite --mode …`).

## Known issue, fixed in Wave 2

An extra assistant bubble repeated the person's question before the answer. It was the transcript's markup: the spelling notice's `v-if` started a new chain, so the answer row's `v-else` also rendered under every message without a spelling notice. The answer row now has its own condition (`TranscriptPane.vue`).
