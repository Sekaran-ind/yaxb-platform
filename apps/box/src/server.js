// yaxb-box: the kiosk's storage on the local network, for a Raspberry Pi (the clinux-box pattern).
// One SQLite file replicated by Litestream; a small JSON API that the kiosk's browser (Storage:
// "Box") and the yaxb CLI use for notebooks, conversations and the agent's long-term store.
//
//   GET    /health                                       no auth: { ok, name, version }
//   GET    /v1/notebooks                                 list (newest first)
//   GET    /v1/notebooks/:id    PUT (body: notebook)     DELETE (also deletes its conversations)
//   GET    /v1/notebooks/:id/threads                     the notebook's conversations
//   GET    /v1/threads/:id      PUT (body: thread)       DELETE
//   GET    /v1/kv/:namespace/:key   PUT { value }  DELETE    LangGraph store items
//   GET    /v1/kv?prefix=<namespace>&limit=&offset=      search a namespace and below
//   GET    /v1/kv-namespaces?limit=&offset=
//   POST   /v1/mailbox  (body: envelope)                 a case on its way to another device (LIB-42..48)
//   GET    /v1/mailbox?roles=a,b&member=&device=         envelopes for them, not picked up, not expired
//   POST   /v1/mailbox/:id/pick  { by }                  take one (its body is deleted)
//   GET    /v1/mailbox-status?ids=a,b                     waiting, delivered or expired
//   GET    /v1/beacons    PUT /v1/beacons/:caseId         who holds which case (moderators' board)
//   GET    /v2/collections/:name?since=<cursor>           sync v2 (SYN-1..6): changed rows since a cursor,
//                                                          tombstones included → { protocol: 2, rows, cursor, more }
//   PUT    /v2/collections/:name/:id  { baseVersion, data, conflict }   → 200 { row } | 409 { conflict, row }
//   DELETE /v2/collections/:name/:id?baseVersion=&conflict=            → 200 | 409, a tombstone
//   POST   /v2/collections/:name/batch  { ops: [{ op: put|delete, id, baseVersion, data }], conflict }
//          (collections: notebooks, threads, schedule, service-data; conflict: reject-stale | last-write-wins)
//   PUT    /v1/media/:hash   (body: the photo's bytes)    a photo or voice note (MED-1, MED-9), kept only if its SHA-256 is :hash
//   GET    /v1/media/:hash                                 the photo, with its type
//   POST   /v1/events  (body: [event])                   a service's events (MET-2): facts, never answers
//   GET    /v1/events?service=&since=                    a service's events, oldest first
//   GET    /v1/connectors                                 box connectors installed here (CNX-4): ids, titles, operations
//   POST   /v1/connectors/:id/:op  { input }              call one on the office network → { ok, status, ms, untrusted, data }
//          (installed and given secrets only from the box's own command line: `yaxb-box connector …`)
//
// Auth: `Authorization: Bearer <a box token from the site>` (IDN-42, verified offline: trust.js), or
// the older shared `Bearer <YAXB_BOX_TOKEN>`, compared in constant time. Bearer tokens, not
// cookies, so CORS can't be used to ride a session; origins are still limited to the kiosk's own
// (YAXB_BOX_ORIGINS). Chrome's Private Network Access preflight is answered for those origins.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { dirname, join } from 'node:path';
import { COLLECTIONS, ID, NAMESPACE, openDb } from './db.js';
import { createSiteLink, verifyBoxToken } from './trust.js';
import { callBoxConnector, ConnectorError } from './connectors.js';

export const VERSION = '0.1.0';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** The longest the box keeps an envelope nobody picks up (30 days). */
const MAILBOX_MAX_HOURS = 30 * 24;

export function loadConfig(env = process.env) {
  return {
    port: Number(env.YAXB_BOX_PORT || 47870),
    certPort: Number(env.YAXB_BOX_CERT_PORT || 47871),
    host: env.YAXB_BOX_HOST || '0.0.0.0',
    dbPath: env.YAXB_BOX_DB || '/var/lib/yaxb-box/yaxb-box.sqlite3',
    token: env.YAXB_BOX_TOKEN || '',
    /** The box's link to the site (IDN-42): its credential and the trust it keeps. */
    linkPath: env.YAXB_BOX_LINK || join(dirname(env.YAXB_BOX_DB || '/var/lib/yaxb-box/yaxb-box.sqlite3'), 'site.json'),
    origins: (env.YAXB_BOX_ORIGINS || '').split(/[\s,]+/).map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    tlsCertPath: env.YAXB_BOX_TLS_CERT || '',
    tlsKeyPath: env.YAXB_BOX_TLS_KEY || '',
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

/** The largest photo the box keeps (the kiosk makes them smaller first). */
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
function readBytes(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new HttpError(413, 'That photo is too large for the box.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'That is too large for the box.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null);
      } catch {
        reject(new HttpError(400, 'The body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function tokenMatches(header, token) {
  const m = /^Bearer (.+)$/.exec(header || '');
  if (!m || !token) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const plainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function createBoxServer(config, { db = openDb(config.dbPath), link = createSiteLink(config.linkPath) } = {}) {
  if (config.token && config.token.length < 32) throw new Error('YAXB_BOX_TOKEN must be at least 32 characters (install.sh generates one)');
  if (!config.token && !link.linked) throw new Error('Sign the box in to your site (yaxb-box login --site https://anjalai.cc), or set YAXB_BOX_TOKEN');
  /** A person's box token (verified offline against the kept trust), or the shared token. */
  const allowed = (header) => {
    if (config.token && tokenMatches(header, config.token)) return true;
    const m = /^Bearer (.+)$/.exec(header || '');
    return Boolean(m && verifyBoxToken(m[1], link.trust));
  };

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser cross-origin request (CLI, curl)
    const allowed = config.origins.includes('*') || config.origins.includes(origin.replace(/\/+$/, ''));
    if (!allowed) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    // Chrome's Private Network Access: a public page may call this LAN address only if we say so.
    if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
    return true;
  }

  // Sync v2 (SYN-1..6; yaxb-core sync/protocol.ts): changes since a cursor, versions, tombstones,
  // batches, and 409 with the box's copy for a stale write under reject-stale.
  async function collectionsV2(req, res, url, name, rawId) {
    if (!COLLECTIONS.includes(name)) throw new HttpError(404, 'No such collection.');
    const body = req.method === 'PUT' || req.method === 'POST' ? await readJson(req) : null;
    const policy = (url.searchParams.get('conflict') || body?.conflict) === 'last-write-wins' ? 'last-write-wins' : 'reject-stale';
    const dataOf = (d) => (plainObject(d) ? d : null);
    if (rawId === undefined) {
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      return send(res, 200, { protocol: 2, ...db.changes(name, url.searchParams.get('since') || '') });
    }
    if (rawId === 'batch') {
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
      const ops = Array.isArray(body?.ops) ? body.ops.slice(0, 500) : [];
      for (const op of ops) {
        if (!plainObject(op) || !ID.test(String(op.id || ''))) throw new HttpError(400, 'Each op needs an id.');
        if (op.op !== 'delete' && !dataOf(op.data)) throw new HttpError(400, `Op ${op.id}: data must be an object.`);
        if (name === 'threads' && op.op !== 'delete' && !ID.test(String(op.data.notebookId || ''))) throw new HttpError(400, 'A conversation needs its notebookId.');
      }
      const results = db.batch(name, ops.map((op) => ({ id: String(op.id), baseVersion: Number(op.baseVersion || 0), data: op.op === 'delete' ? null : op.data, deleted: op.op === 'delete' })), policy);
      return send(res, 200, { protocol: 2, results: results.map((r) => (r.ok ? { id: r.id, ok: true, row: r.row } : { id: r.id, conflict: true, row: r.row })) });
    }
    if (!ID.test(rawId)) throw new HttpError(400, 'Bad id.');
    if (req.method === 'PUT') {
      if (!dataOf(body?.data)) throw new HttpError(400, 'The body is { baseVersion, data: { … } }.');
      if (name === 'threads' && !ID.test(String(body.data.notebookId || ''))) throw new HttpError(400, 'A conversation needs its notebookId.');
      const r = db.write(name, { id: rawId, baseVersion: Number(body.baseVersion || 0), data: body.data }, policy);
      return r.ok ? send(res, 200, { protocol: 2, row: r.row }) : send(res, 409, { conflict: true, row: r.row });
    }
    if (req.method === 'DELETE') {
      const r = db.write(name, { id: rawId, baseVersion: Number(url.searchParams.get('baseVersion') || 0), deleted: true }, policy);
      return r.ok ? send(res, 200, { protocol: 2, row: r.row }) : send(res, 409, { conflict: true, row: r.row });
    }
    throw new HttpError(405, 'Method not allowed.');
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://box');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!cors(req, res)) return send(res, 403, { error: 'This origin may not use the box. Add it to YAXB_BOX_ORIGINS.' });
    if (req.method === 'OPTIONS') return send(res, 204);
    if (url.pathname === '/health') return send(res, 200, { ok: true, name: 'yaxb-box', version: VERSION });
    if (!allowed(req.headers.authorization)) return send(res, 401, { error: 'The box token is missing or wrong (or its device was signed out).' });
    if (parts[0] === 'v2' && parts[1] === 'collections') return collectionsV2(req, res, url, parts[2], parts[3]);
    if (parts[0] !== 'v1') throw new HttpError(404, 'Not found.');

    const [, resource, a, b] = parts;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

    if (COLLECTIONS.includes(resource)) {
      if (!a) {
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
        return send(res, 200, { items: db.list(resource, { limit }) });
      }
      if (!ID.test(a)) throw new HttpError(400, 'Bad id.');
      if (resource === 'notebooks' && b === 'threads') {
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
        return send(res, 200, { items: db.list('threads', { parent: a, limit }) });
      }
      if (b) throw new HttpError(404, 'Not found.');
      if (req.method === 'GET') {
        const r = db.get(resource, a);
        return r ? send(res, 200, r) : send(res, 404, { error: 'Not found.' });
      }
      if (req.method === 'PUT') {
        const body = await readJson(req);
        if (!plainObject(body)) throw new HttpError(400, 'The body must be an object.');
        // The URL's id wins over anything in the body.
        const data = { ...body, id: a };
        let parent = null;
        if (resource === 'threads') {
          if (typeof body.notebookId !== 'string' || !ID.test(body.notebookId)) throw new HttpError(400, 'A conversation needs its notebookId.');
          parent = body.notebookId;
        }
        return send(res, 200, db.put(resource, a, parent, data));
      }
      if (req.method === 'DELETE') {
        db.delete(resource, a);
        return send(res, 204);
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    if (resource === 'kv') {
      if (!a) {
        const prefix = url.searchParams.get('prefix') || '';
        if (!NAMESPACE.test(prefix)) throw new HttpError(400, 'Bad namespace prefix.');
        return send(res, 200, { items: db.kvSearch(prefix, { limit, offset }) });
      }
      if (!NAMESPACE.test(a) || !b || b.length > 300) throw new HttpError(400, 'Bad namespace or key.');
      if (req.method === 'GET') {
        const r = db.kvGet(a, b);
        return r ? send(res, 200, r) : send(res, 404, { error: 'Not found.' });
      }
      if (req.method === 'PUT') {
        const body = await readJson(req);
        if (!plainObject(body) || !plainObject(body.value)) throw new HttpError(400, 'The body is { value: { … } }.');
        db.kvPut(a, b, body.value);
        return send(res, 204);
      }
      if (req.method === 'DELETE') {
        db.kvPut(a, b, null);
        return send(res, 204);
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    if (resource === 'mailbox') {
      if (!a && req.method === 'POST') {
        const e = await readJson(req);
        const ok =
          plainObject(e) && ID.test(String(e.id)) && (e.kind === 'case' || e.kind === 'reassign') && plainObject(e.to) && typeof e.expires_at === 'string' && typeof e.created_at === 'string';
        if (!ok) throw new HttpError(400, 'That is not an envelope.');
        const latest = new Date(Date.now() + MAILBOX_MAX_HOURS * 3_600_000).toISOString();
        db.mailboxPost({ ...e, expires_at: e.expires_at > latest ? latest : e.expires_at });
        return send(res, 204);
      }
      if (!a && req.method === 'GET') {
        const roles = (url.searchParams.get('roles') || '').split(',').filter(Boolean).slice(0, 20);
        return send(res, 200, { items: db.mailboxInbox({ roles, member: url.searchParams.get('member') || undefined, device: url.searchParams.get('device') || undefined }) });
      }
      if (a && b === 'pick' && req.method === 'POST') {
        if (!ID.test(a)) throw new HttpError(400, 'Bad id.');
        const body = await readJson(req);
        return send(res, 200, { picked: db.mailboxPick(a, String(body?.by ?? 'someone').slice(0, 80)) });
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    if (resource === 'mailbox-status' && req.method === 'GET') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter((x) => ID.test(x)).slice(0, 100);
      return send(res, 200, { status: db.mailboxStatus(ids) });
    }
    if (resource === 'media') {
      if (!/^[0-9a-f]{64}$/.test(a || '')) throw new HttpError(400, 'A photo is addressed by its SHA-256.');
      if (req.method === 'GET') {
        const m = db.media(a);
        if (!m) throw new HttpError(404, 'That photo isn\'t on the box.');
        res.writeHead(200, { 'Content-Type': m.type, 'Content-Length': m.size, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        return res.end(Buffer.from(m.data));
      }
      if (req.method === 'PUT') {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim();
        if (!/^(image\/(jpeg|png|webp)|audio\/(webm|ogg|mp4|mpeg|aac|wav))$/.test(type)) throw new HttpError(415, 'Only photos (JPEG, PNG, WebP) and voice notes.');
        const data = await readBytes(req, MAX_MEDIA_BYTES);
        if (createHash('sha256').update(data).digest('hex') !== a) throw new HttpError(400, 'The photo doesn\'t match its hash.');
        db.putMedia(a, type, data);
        return send(res, 200, { hash: a, size: data.length });
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    if (resource === 'events') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        const ok = Array.isArray(body) && body.length > 0 && body.length <= 200 && body.every((e) => plainObject(e) && ID.test(String(e.id)) && typeof e.service === 'string' && typeof e.kind === 'string' && typeof e.at === 'string' && !('answers' in e));
        if (!ok) throw new HttpError(400, 'That is not a batch of events.');
        db.eventsAdd(body);
        return send(res, 204);
      }
      if (req.method === 'GET') {
        const service = url.searchParams.get('service') || '';
        if (!ID.test(service)) throw new HttpError(400, 'Which service?');
        return send(res, 200, { items: db.eventsList(service, url.searchParams.get('since') || '', Math.min(Number(url.searchParams.get('limit') || 10000), 10000)) });
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    if (resource === 'connectors') {
      if (!a && req.method === 'GET') {
        return send(res, 200, { items: db.connectorList().map((c) => ({ id: c.id, title: c.title, host: new URL(c.base).host, operations: c.operations.map((o) => ({ id: o.id, label: o.label ?? o.id, method: o.method })), secrets: db.connectorSecretNames(c.id).map((x) => x.name), installed_at: c.installed_at })) });
      }
      if (a && b && req.method === 'POST') {
        const c = ID.test(a) ? db.connectorGet(a) : null;
        if (!c) throw new HttpError(404, 'That connector isn\'t installed on this box.');
        const body = await readJson(req);
        const input = plainObject(body?.input) ? body.input : {};
        try {
          return send(res, 200, await callBoxConnector(c, b, input, db.connectorSecrets(a), config.fetch ?? fetch));
        } catch (e) {
          if (e instanceof ConnectorError) throw new HttpError(e.status, e.message);
          throw e;
        }
      }
      throw new HttpError(405, 'Method not allowed.');
    }
    if (resource === 'beacons') {
      if (!a && req.method === 'GET') return send(res, 200, { items: db.beaconList() });
      if (a && req.method === 'PUT') {
        if (!ID.test(a)) throw new HttpError(400, 'Bad id.');
        const body = await readJson(req);
        if (!plainObject(body) || body.case_id !== a || typeof body.expires_at !== 'string') throw new HttpError(400, 'That is not a beacon.');
        db.beaconPut(body);
        return send(res, 204);
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    if (resource === 'kv-namespaces' && req.method === 'GET') return send(res, 200, { items: db.kvNamespaces({ limit, offset }) });
    throw new HttpError(404, 'Not found.');
  }

  const handler = (req, res) => {
    route(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(`yaxb-box: ${req.method} ${req.url?.split('?')[0]} failed: ${e?.name}`);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'The box had a problem.' : e.message });
    });
  };

  let tls = null;
  if (config.tlsCertPath && config.tlsKeyPath) tls = { cert: readFileSync(config.tlsCertPath), key: readFileSync(config.tlsKeyPath) };
  const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);

  // With TLS, a plain-HTTP page offers the certificate, so each device can trust it once.
  const certServer = tls
    ? createHttpServer((req, res) => {
        if (req.url === '/yaxb-box.crt') {
          res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="yaxb-box.crt"' });
          return res.end(tls.cert);
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>yaxb-box</title><h1>yaxb-box certificate</h1><p><a href="/yaxb-box.crt">Download the certificate</a>, install and trust it on this device, then use the box at <code>https://&lt;this address&gt;:${config.port}</code>.</p>`);
      })
    : null;

  // The owner's trust, fetched every few minutes while the site can be reached (IDN-42).
  let refreshing = null;
  return {
    db,
    tls: Boolean(tls),
    server,
    link,
    listen: () =>
      new Promise((resolve) => {
        if (link.linked) {
          void link.refresh();
          refreshing = setInterval(() => void link.refresh(), 5 * 60_000);
          refreshing.unref?.();
        }
        server.listen(config.port, config.host, () => {
          if (certServer) certServer.listen(config.certPort, config.host, resolve);
          else resolve();
        });
      }),
    address: () => server.address(),
    close: () =>
      new Promise((resolve) => {
        if (refreshing) clearInterval(refreshing);
        certServer?.close();
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections?.();
      }),
  };
}
