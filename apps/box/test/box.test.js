import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createBoxServer } from '../src/server.js';

const TOKEN = 'test-token-0123456789-0123456789-abcdef';
const ORIGIN = 'http://localhost:3000';
let box;
let base;
let dir;

const call = (path, { method = 'GET', body, token = TOKEN, origin, headers = {} } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'yaxb-box-'));
  box = createBoxServer({ port: 0, certPort: 0, host: '127.0.0.1', dbPath: join(dir, 'box.sqlite3'), token: TOKEN, origins: [ORIGIN], tlsCertPath: '', tlsKeyPath: '' });
  await box.listen();
  base = `http://127.0.0.1:${box.address().port}`;
});
after(async () => {
  await box.close();
  rmSync(dir, { recursive: true, force: true });
});

test('refuses a short token at start', () => {
  assert.throws(() => createBoxServer({ token: 'short', dbPath: ':memory:' }), /at least 32 characters/);
});

test('health needs no token; everything else does', async () => {
  assert.equal((await call('/health', { token: null })).status, 200);
  assert.equal((await call('/v1/notebooks', { token: null })).status, 401);
  assert.equal((await call('/v1/notebooks', { token: `${TOKEN}x` })).status, 401);
  assert.equal((await call('/v1/notebooks')).status, 200);
});

test('CORS and Private Network Access only for allowed origins', async () => {
  const pre = await call('/v1/notebooks', { method: 'OPTIONS', token: null, origin: ORIGIN, headers: { 'Access-Control-Request-Private-Network': 'true', 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
  assert.equal((await call('/v1/notebooks', { origin: 'https://evil.example' })).status, 403);
});

test('notebooks and their conversations; deleting a notebook deletes its conversations', async () => {
  const nb = { title: 'Knee operation', sources: [{ id: 's1', title: 'Leaflet', mime: 'text/plain', text: 'Stop eating 6 hours before.', addedAt: '2026-11-10' }], memory: '', createdAt: 'x', updatedAt: 'x' };
  assert.equal((await call('/v1/notebooks/nb1', { method: 'PUT', body: { ...nb, id: 'sneaky' } })).status, 200);
  const got = await (await call('/v1/notebooks/nb1')).json();
  assert.equal(got.data.id, 'nb1'); // the URL's id wins
  assert.equal(got.data.sources[0].text, 'Stop eating 6 hours before.');

  assert.equal((await call('/v1/threads/t1', { method: 'PUT', body: { title: 'q', turns: [] } })).status, 400); // needs notebookId
  await call('/v1/threads/t1', { method: 'PUT', body: { notebookId: 'nb1', title: 'When do I stop eating?', turns: [], state: null } });
  await call('/v1/threads/t2', { method: 'PUT', body: { notebookId: 'other', title: 'x', turns: [], state: null } });
  const threads = await (await call('/v1/notebooks/nb1/threads')).json();
  assert.deepEqual(threads.items.map((t) => t.id), ['t1']);

  assert.equal((await call('/v1/notebooks/nb1', { method: 'DELETE' })).status, 204);
  assert.equal((await call('/v1/threads/t1')).status, 404);
  assert.equal((await call('/v1/threads/t2')).status, 200);
});

test('rejects bad ids and non-object bodies', async () => {
  assert.equal((await call('/v1/notebooks/..%2Fetc')).status, 400);
  assert.equal((await call('/v1/notebooks/nb2', { method: 'PUT', body: [1, 2] })).status, 400);
  assert.equal((await call('/v1/nope')).status, 404);
});

test('kv store: put, get, search by namespace prefix, delete', async () => {
  await call('/v1/kv/yaxb.memories.web-abc.nb1/AGENTS.md', { method: 'PUT', body: { value: { content: ['# Memory', '- Prefers Tamil'] } } });
  await call('/v1/kv/yaxb.memories.web-abc.nb2/AGENTS.md', { method: 'PUT', body: { value: { content: ['other'] } } });
  await call('/v1/kv/yaxb.memoriesX/AGENTS.md', { method: 'PUT', body: { value: { content: ['not under the prefix'] } } });
  const item = await (await call('/v1/kv/yaxb.memories.web-abc.nb1/AGENTS.md')).json();
  assert.deepEqual(item.namespace, ['yaxb', 'memories', 'web-abc', 'nb1']);
  assert.deepEqual(item.value.content, ['# Memory', '- Prefers Tamil']);
  const found = await (await call('/v1/kv?prefix=yaxb.memories')).json();
  assert.deepEqual(found.items.map((i) => i.namespace.at(-1)).sort(), ['nb1', 'nb2']);
  assert.equal((await call('/v1/kv/yaxb.memories.web-abc.nb1/AGENTS.md', { method: 'DELETE' })).status, 204);
  assert.equal((await call('/v1/kv/yaxb.memories.web-abc.nb1/AGENTS.md')).status, 404);
});

test('data survives a restart (one SQLite file, WAL mode)', async () => {
  const path = join(dir, 'restart.sqlite3');
  const cfg = { port: 0, certPort: 0, host: '127.0.0.1', dbPath: path, token: TOKEN, origins: [], tlsCertPath: '', tlsKeyPath: '' };
  let b = createBoxServer(cfg);
  await b.listen();
  await fetch(`http://127.0.0.1:${b.address().port}/v1/notebooks/keep`, { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Kept' }) });
  assert.equal(b.db.raw.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  await b.close();
  b = createBoxServer(cfg);
  await b.listen();
  const r = await fetch(`http://127.0.0.1:${b.address().port}/v1/notebooks/keep`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal((await r.json()).data.title, 'Kept');
  await b.close();
});

test('mailbox: an envelope waits for its role until picked up (its body then gone) or expired', async () => {
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  const env = (id, to, expires_at = soon) => ({ id, kind: 'case', to, from: { id: 'guest:k', name: 'Visitor', device: 'k' }, case_id: 'c1', ref: 'R-ABCDEF', created_at: new Date().toISOString(), expires_at, body: { case: { id: 'c1' }, events: [] } });
  assert.equal((await call('/v1/mailbox', { method: 'POST', body: { id: 'x' } })).status, 400);
  assert.equal((await call('/v1/mailbox', { method: 'POST', body: env('e-1', { roles: ['organiser'] }) })).status, 204);
  assert.equal((await call('/v1/mailbox', { method: 'POST', body: env('e-2', { device: 'kiosk-1' }) })).status, 204);
  assert.equal((await call('/v1/mailbox', { method: 'POST', body: env('e-3', { roles: ['organiser'] }, past) })).status, 204);
  const org = await (await call('/v1/mailbox?roles=organiser')).json();
  assert.deepEqual(org.items.map((e) => e.id), ['e-1']);
  const dev = await (await call('/v1/mailbox?roles=marshal&device=kiosk-1')).json();
  assert.deepEqual(dev.items.map((e) => e.id), ['e-2']);
  assert.deepEqual(await (await call('/v1/mailbox/e-1/pick', { method: 'POST', body: { by: 'Olu' } })).json(), { picked: true });
  assert.deepEqual(await (await call('/v1/mailbox/e-1/pick', { method: 'POST', body: { by: 'Ola' } })).json(), { picked: false });
  const st = await (await call('/v1/mailbox-status?ids=e-1,e-2,e-3')).json();
  assert.deepEqual(st.status, { 'e-1': { state: 'delivered', picked_by: 'Olu' }, 'e-2': { state: 'waiting', picked_by: null }, 'e-3': { state: 'expired', picked_by: null } });
  const row = box.db.raw.prepare('SELECT body FROM mailbox WHERE id = ?').get('e-1');
  assert.equal(row.body, null);
});

test('beacons: who holds which case, until they expire', async () => {
  const b = { case_id: 'c9', ref: 'R-ZZZZZZ', journey_title: 'Register', service_title: 'Marathon', status: 'waiting', role: 'organiser', holder: { roles: ['organiser'] }, holder_name: null, copies: ['k'], updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() };
  assert.equal((await call('/v1/beacons/c8', { method: 'PUT', body: b })).status, 400);
  assert.equal((await call('/v1/beacons/c9', { method: 'PUT', body: b })).status, 204);
  const list = await (await call('/v1/beacons')).json();
  assert.deepEqual(list.items.map((x) => x.ref), ['R-ZZZZZZ']);
});

test('events: a service keeps its journeys facts, once each, and lists them since a time', async () => {
  const e = (id, at) => ({ id, service: 'svc-1', journey: 'j', kind: 'journey.started', step: null, role: null, run: 'r', at, ms: null, ok: null, actor: null });
  assert.equal((await call('/v1/events', { method: 'POST', body: [{ id: 'x' }] })).status, 400);
  assert.equal((await call('/v1/events', { method: 'POST', body: [e('ev-1', '2026-11-16T09:00:00Z'), e('ev-2', '2026-11-16T10:00:00Z')] })).status, 204);
  assert.equal((await call('/v1/events', { method: 'POST', body: [e('ev-1', '2026-11-16T09:00:00Z')] })).status, 204);
  const all = await (await call('/v1/events?service=svc-1')).json();
  assert.deepEqual(all.items.map((x) => x.id), ['ev-1', 'ev-2']);
  const later = await (await call('/v1/events?service=svc-1&since=2026-11-16T09:30:00Z')).json();
  assert.deepEqual(later.items.map((x) => x.id), ['ev-2']);
});

test('sync v2: changes since a cursor, versions, 409 on a stale write, tombstones, batches, v1 alongside (SYN-1..4)', async () => {
  const json = async (r) => ({ status: r.status, body: await r.json() });
  // A device creates a schedule item (baseVersion 0) and a second write with the version it saw.
  let r = await json(await call('/v2/collections/schedule/mum', { method: 'PUT', body: { baseVersion: 0, data: { title: "Mum's birthday" } } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.row.version, 1);
  r = await json(await call('/v2/collections/schedule/mum', { method: 'PUT', body: { baseVersion: 1, data: { title: "Mum's birthday", date: '2027-03-03' } } }));
  assert.equal(r.body.row.version, 2);
  // Another device still on version 1: refused, with the box's copy.
  r = await json(await call('/v2/collections/schedule/mum', { method: 'PUT', body: { baseVersion: 1, data: { title: 'Old' } } }));
  assert.equal(r.status, 409);
  assert.equal(r.body.conflict, true);
  assert.equal(r.body.row.data.date, '2027-03-03');
  // ...unless it asks for last-write-wins.
  r = await json(await call('/v2/collections/schedule/mum?conflict=last-write-wins', { method: 'PUT', body: { baseVersion: 1, data: { title: 'Forced' } } }));
  assert.equal(r.body.row.version, 3);
  // Changes since nothing: the row, once; since the cursor: nothing new.
  r = await json(await call('/v2/collections/schedule'));
  assert.deepEqual(r.body.rows.map((x) => [x.id, x.version]), [['mum', 3]]);
  const cursor = r.body.cursor;
  r = await json(await call(`/v2/collections/schedule?since=${cursor}`));
  assert.deepEqual(r.body.rows, []);
  // A batch: one new, one stale.
  r = await json(await call('/v2/collections/schedule/batch', { method: 'POST', body: { ops: [{ op: 'put', id: 'dentist', baseVersion: 0, data: { title: 'Dentist' } }, { op: 'put', id: 'mum', baseVersion: 1, data: { title: 'x' } }] } }));
  assert.deepEqual(r.body.results.map((x) => [x.id, Boolean(x.ok), Boolean(x.conflict)]), [['dentist', true, false], ['mum', false, true]]);
  // A delete is a tombstone, pulled like any change, and gone from v1 lists.
  r = await json(await call('/v2/collections/schedule/dentist?baseVersion=1', { method: 'DELETE' }));
  assert.equal(r.body.row.deleted, true);
  r = await json(await call(`/v2/collections/schedule?since=${cursor}`));
  assert.deepEqual(r.body.rows.map((x) => [x.id, x.deleted, x.data]), [['dentist', true, null]]);
  r = await json(await call('/v1/schedule'));
  assert.deepEqual(r.body.items.map((x) => x.id), ['mum']);
  // A v1 write bumps the version, so v2 devices see it; a v1 notebook delete tombstones its conversations.
  await call('/v1/notebooks/nbsync', { method: 'PUT', body: { title: 'Home' } });
  await call('/v1/threads/tsync', { method: 'PUT', body: { notebookId: 'nbsync', title: 'Hello' } });
  await call('/v1/notebooks/nbsync', { method: 'PUT', body: { title: 'Home 2' } });
  r = await json(await call('/v2/collections/notebooks'));
  assert.equal(r.body.rows.find((x) => x.id === 'nbsync').version, 2);
  await call('/v1/notebooks/nbsync', { method: 'DELETE' });
  r = await json(await call('/v2/collections/threads'));
  assert.deepEqual(r.body.rows.filter((x) => x.id === 'tsync').map((x) => [x.id, x.deleted]), [['tsync', true]]);
  // Unknown collections and bad bodies are refused.
  assert.equal((await call('/v2/collections/secrets')).status, 404);
  assert.equal((await call('/v2/collections/threads/t2', { method: 'PUT', body: { baseVersion: 0, data: { title: 'no notebook' } } })).status, 400);
});

test('keeps a photo by its hash, and refuses one that doesn\'t match (MED-1)', async () => {
  const { createHash } = await import('node:crypto');
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const put = (h, body, type = 'image/jpeg') => fetch(`${base}/v1/media/${h}`, { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': type }, body });
  assert.equal((await put(hash, bytes)).status, 200);
  assert.equal((await put('0'.repeat(64), bytes)).status, 400, 'wrong hash');
  assert.equal((await put(hash, bytes, 'text/html')).status, 415, 'not a photo');
  const got = await fetch(`${base}/v1/media/${hash}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes);
  assert.equal((await fetch(`${base}/v1/media/${'1'.repeat(64)}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
  assert.equal((await fetch(`${base}/v1/media/${hash}`)).status, 401, 'needs the token');
});
