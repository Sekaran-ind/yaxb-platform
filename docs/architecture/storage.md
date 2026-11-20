# Storage and sync with the box

Part of the architecture notes for Claude Code; the index is in [CLAUDE.md](../../CLAUDE.md).

## Storage (configurable, Deep Agents backends)

The device (STO-1..3): `lib/browser/storage-meter.ts` (`measureStorage`, `askPersistence`, `bytesText`) and `components/settings/StorageMeter.vue` under Preferences → Storage; `App.vue` asks for persistent storage on the native app, an installed app and a front desk. A front desk session's end (`sessionEnds`) also clears the message box (`TranscriptPane`) and the spelling dictionary (`forgetSpelling`).

Settings → Storage: `indexeddb` | `session` | `box` | `server`.
- **Browser / session / box**: the browser keeps notebooks and conversations (`apps/web/src/lib/browser/store.ts`; box = yaxb-box over `@sekaran-ind/yaxb-core/stores/box`). Each turn sends them; the core returns the conversation and memory in the `state` event. The box connection (`settings.box`) stays in localStorage and is never sent to the Worker.
- **Server**: conversations in D1 (`ThreadStore`); the agent's `/memories/` through Deep Agents' `CompositeBackend` → `StoreBackend` over `KvStore` (a LangGraph `BaseStore`, `stores/kv.ts`) on D1 (`createD1Kv`, migration 0002). Namespace `yaxb.memories.<caller>.<notebook>` from `config.configurable.memoryNamespace`; seeded once from the notebook's memory. `harness.ts backendFor()` builds the backend and passes it to the filesystem middleware too (our custom one replaces Deep Agents' default by name, so it must get the backend).
- **CLI**: `YAXB_BOX_URL` + `YAXB_BOX_TOKEN` → conversations and `/memories/` on the box.
- **apps/box** (yaxb-box) checks people offline (IDN-42): `yaxb-box login --site` signs the box in (client `box`); `src/trust.js` keeps its owner's trust (`site.json`, refreshed every five minutes from `/api/identity/box/trust`) and verifies box tokens (core `boxToken`/`boxTrust`, `BOX_TOKEN_DAYS`; Preferences → Storage → Connect with my account) with `node:crypto`; `YAXB_BOX_TOKEN` is optional once the box is signed in. `packages/yaxb-core/test/box-trust.test.ts` checks the site and the box agree.
- **apps/box** (yaxb-box): zero-dependency Node server for a Raspberry Pi: `node:sqlite` in WAL mode, Litestream replica, systemd units, self-signed TLS, bearer token, CORS + Private Network Access only for `YAXB_BOX_ORIGINS`. `node yaxb.mjs box` runs one locally; `node yaxb.mjs box-deploy --host user@pi` installs it on a Pi. The web CSP allows the box via `KIOSK_BOX_ORIGINS` (wrangler `vars`; locally `apps/web/.env.local`).

## Sync with the box (SYN-1..6)

- Box: records carry `version`, `deleted`, `seq` (migration 4); `/v2/collections/:name` (GET `?since=`, PUT/DELETE with `baseVersion`, POST `/batch`, `conflict` reject-stale | last-write-wins); collections notebooks, threads, schedule, service-data; v1 writes bump versions, v1 deletes tombstone.
- Core `sync/` (export `./sync`): `applyWrite`, cursors, `createSyncEngine({ remote, shadows, adapters })` (`track`, `sync`, `conflicts`, `resolve(key, "mine" | "theirs")`), `createMemoryShadows`, `boxRemote`; box client `changes` and `batch`.
- Web: Storage "box" is a local IndexedDB copy (`storeFor` → `syncedStore`) whose writes go through `lib/browser/sync-hook.ts` `trackWrite` (also the Scheduler and `library.ts`'s loaded services, `SERVICE_DATA_ID`); `lib/browser/sync-shadows.ts` (IndexedDB `yaxb-sync`); `composables/sync.ts` (`startSync` from App.vue, `syncState`, `syncConflicts`, `resolveConflict`, `syncPulls`); `components/settings/BoxSync.vue` in Preferences → Storage.
