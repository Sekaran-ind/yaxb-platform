# Hand-over: where things stand

Last updated 2026-11-19, when the first part of Wave 2 was deployed. The rest of Wave 2 continues on the other laptop. Read this with `CLAUDE.md` (how the code is built) and `docs/specs/` (every requirement and its status). Together they replace the notes a previous Claude session kept outside the repo.

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

## Wave 2 so far: deployed on 2026-11-19

Merged as PRs #32 and #34 (#33 shipped inside #34) and deployed to all four sites. Remote migrations are applied up to the editions' `0016_organisation.sql` and the platform database's `0003_pending_joins.sql`.

- **The organisation design** (ORG-1..5, 8, 9): units, reporting lines, "the requester's manager", fifteen templates, checks before publishing.
- **The catalogue's player** holds its controls, and a new service is designed as a conversation in Ask Me (LIB-64). Also fixed: the extra bubble that repeated the question before each answer.
- **Identity step 1 with spaces** (IDN-1..6, 10, 14, 21, 40, 50..54; SPC-1..4, 6..8, 10):
  - Passkeys, Google and recovery codes. SMS, WhatsApp and email codes wait for a later release (decided 2026-11-19).
  - The guided **your-account journey** in the conversation: sign in, then open, start or join a space.
  - The space picker, and the Account button in the Business player.

**Accounts are off on the live sites until `IDENTITY_SECRET` is set** (`/api/identity/config` says `enabled: false`). Setting production secrets is for the owner to run:
1. Make one secret of 32+ characters and keep it in the password manager: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. Put it on the one Worker, from `apps/web`: `npx wrangler secret put IDENTITY_SECRET` (since one address serves every edition, `yaxb-web` is the only Worker). Changing it later signs everyone out and makes the stored signing keys unreadable.
3. Optional, Google: a Google Cloud project → APIs & Services → OAuth consent screen (external, the app's name and the support email), then Credentials → OAuth client ID → Web application, with an authorised redirect URI per site: `https://family.anjalai.cc/api/identity/google/callback`, the same for business, community and anjalai.cc. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the Worker. Without them, Google isn't offered.

No redeploy is needed after setting a secret.

## One address for every edition: built, waiting for the owner's deploy

Decided 2026-11-19, built in the PR "One address for every edition" (SUR-14). One Worker, `yaxb-web` (`apps/web/wrangler.jsonc`), and one build serve every address. Each request acts in one edition: the open space's, else the address's (`family.anjalai.cc` is Family), else the portal. The edition chooses the sections and the database (`worker/edition.ts`: `DB` is the portal's yaxb, `DB_FAMILY`, `DB_BUSINESS`, `DB_COMMUNITY`). No data moves. Switching space stays on the same address. The per-edition wrangler files and `--mode family|business|community` builds are gone.

**Deploying it (the owner runs these; each step needs the owner's go-ahead):**
1. **Secrets on `yaxb-web`.** It is now the only Worker, so it needs every secret the edition Workers had: `npx wrangler secret list` and `npx wrangler secret list -c <old file>` (the old files are in git history) show the names. At least `SESSION_SECRET`, `ADMIN_TOKEN`, the provider keys, `TAVILY_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `IDENTITY_SECRET` (see above; now set once).
   - **One `ADMIN_TOKEN`** administers every edition (by address or open space). The Family, Business and Community tokens stop working; keep the one `yaxb-web` has in the password manager.
   - **One `SESSION_SECRET`.** Visitors on the three edition addresses get new sessions: a guest's unsaved catalogue drafts on Business and Community are no longer theirs. Members keep their keys.
2. **Deploy:** `node yaxb.mjs deploy` (or `npm run deploy` in `apps/web`). It applies the migrations to all five databases, builds once and deploys. The deploy takes the custom domains family., business. and community.anjalai.cc from the edition Workers (and declares anjalai.cc and yaxb.ai).
3. **Check:** each address shows its own home page; a Business and a Family space switch on one address.
4. **Retire** the anjal-family, anjal-business and anjal-community Workers once the new one serves their addresses. Never delete their databases: `yaxb-web` uses them.

**`MODERATOR_TOKEN` is retired** (IDN-44): the Worker ignores it, so the secret can be deleted (`npx wrangler secret delete MODERATOR_TOKEN`). People sign in with their account or their own key; routines use machine keys (Administration → Add a machine). `ADMIN_TOKEN` stays for break-glass use.

**Waiting for the owner's accounts:** sign in with a personal Microsoft account and with Apple (IDN-14) need a Microsoft app registration and an Apple developer key to test against; a business's Entra ID already works through its own sign-in (IDN-15).

**The native app's tokens** are in its private storage; the Keychain or Keystore needs a secure-storage plugin (ask before adding one).

**Locally:** `node yaxb.mjs start`, then http://localhost:3000 (the portal) and http://family.localhost:3000, http://business.localhost:3000, http://community.localhost:3000. Each local address is its own passkey relying party and has its own cookies, so sign in on each.

## Wave 2: what is left (on the other laptop)

- **Identity, the rest of step 1:**
  - Link the device profile to the account (IDN-1, 4).
  - A child's profile under a guardian's account (IDN-5).
  - Start a space from an organisation template (SPC-8).
  - Join links on Family (today only Business and Community have them).
- **Identity, steps 2 to 6** (`15-identity.md`, Order of work):
  - Step 2: retire `MODERATOR_TOKEN`, lock a front desk to its space, children's spaces (IDN-16, 44; SPC-5, 9).
  - Step 3: assurance levels (IDN-30..34).
  - Step 4: CLI and box sign-in (IDN-17, 18, 41, 42).
  - Step 5: SMS, WhatsApp and email codes, Microsoft, Apple, a business's own provider, the native app (IDN-11..15, 43).
  - Step 6: QR hand-off (IDN-19).
- **Organisation:** business identity numbers (ORG-6, 7), and ORG-4 weighted by case events.
- **Everything below** under "Wave 2: where to start" that isn't listed as done here.
- **When routines are deployed** (built 2026-11-20, RTN-1..5, 7, 13): `deploy` applies migration 0019 to every edition's database, and the Cron Trigger (`*/15 * * * *`) starts with the Worker. The Monday summary needs the service to keep its records on the server (the paid plan); the late check-in alert works with any storage, because kiosks forward the events it waits for. Hooks (RTN-6, 8, 9, 11, 12) are the next PR.

**Order decided 2026-11-19:** one address first (above), then identity steps 2 to 6, the email assistant, media, connectors and routines, and the foundations. **Editions (EDN-6..10, EDN-30..35, households across devices) are deferred.** The vocabulary tool waits for the owner's word-list source.

## Wave 2: where to start

Each spec file ends with an "Order of work". Requirements still Planned or Partly built:
- **Identity** (`15-identity.md`) and the **email assistant** (`16-email-assistant.md`). Both use the platform database.
- **Media, connectors and routines** (`14-media-connectors-routines.md`). Reading bills from billers' pages (BIL-3, WEB-30) is parked and will be built as part of the Playwright work.
- **Editions** (`12-platform-and-editions.md`), deferred (2026-11-19):
  - EDN-6..10 (committees, elections, notices to members);
  - children and elders (EDN-30..35);
  - households across several devices (EDN-20 works on one shared device today).
- **Foundations** (`13-foundations.md`):
  - SPL-8..9; ETH-2..3 and ETH-5's published rules; AUD-1, 4..6 and the box's daily chain check;
  - STO-4..9, RET, VIS, ORG, VOC, FAQ, SNB.
- **The vocabulary tool** (SPL-11..14) is to be built separately, as the owner decided. Its general word list per language needs the owner's choice of an openly licensed source.

## How the owner likes to work

- **Momentum over questions.** Pick sensible defaults, carry on, and list the choices in the summary.
- **One PR per item.** For a wave the owner has started, merge each PR once the local tests pass (no waiting for the Android check), then go on to the next item. The Android (`apk`) build and check run after the merge, always before a deploy.
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

From the repo root, `node yaxb.mjs deploy`: it applies the migrations of all five databases (the portal's, the three editions' and the platform database), builds once and deploys the one Worker. Each deploy needs the owner's go-ahead.

## Windows gotchas on the first laptop

- **Run the core's vitest from PowerShell** with an upper-case `C:` path. From Git Bash's `/c/` path, every test file fails with "reading 'config'".
- **Stop local servers with `node yaxb.mjs stop`.** Stopping a background wrangler or vite only kills the wrapper, and its workerd and esbuild children keep running.
- **PowerShell 5.1** writes files with a byte-order mark. Strip it from JSON files.
- **Vite in dev** may load a module twice, under a `?t=` URL, after a hot update.
- **Rebuilding yaxb-core (or yaxb-journeys) while a dev server runs** can leave its Worker broken ("Internal Server Error: Cannot convert undefined or null to object" from `runner-worker`): the Worker reloaded while `dist/` was half written. Restart that server (`node yaxb.mjs restart`, or stop and start the edition's `vite --mode …`).

## Known issue, fixed in Wave 2

An extra assistant bubble repeated the person's question before the answer. It was the transcript's markup: the spelling notice's `v-if` started a new chain, so the answer row's `v-else` also rendered under every message without a spelling notice. The answer row now has its own condition (`TranscriptPane.vue`).
