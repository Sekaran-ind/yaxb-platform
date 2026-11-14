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
