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
//
// Auth: `Authorization: Bearer <YAXB_BOX_TOKEN>`, compared in constant time. Bearer tokens, not
// cookies, so CORS can't be used to ride a session; origins are still limited to the kiosk's own
// (YAXB_BOX_ORIGINS). Chrome's Private Network Access preflight is answered for those origins.
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { COLLECTIONS, ID, NAMESPACE, openDb } from './db.js';

export const VERSION = '0.1.0';
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function loadConfig(env = process.env) {
  return {
    port: Number(env.YAXB_BOX_PORT || 47870),
    certPort: Number(env.YAXB_BOX_CERT_PORT || 47871),
    host: env.YAXB_BOX_HOST || '0.0.0.0',
    dbPath: env.YAXB_BOX_DB || '/var/lib/yaxb-box/yaxb-box.sqlite3',
    token: env.YAXB_BOX_TOKEN || '',
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

export function createBoxServer(config, { db = openDb(config.dbPath) } = {}) {
  if (!config.token || config.token.length < 32) throw new Error('YAXB_BOX_TOKEN must be set, at least 32 characters (install.sh generates one)');

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser cross-origin request (CLI, curl)
    const allowed = config.origins.includes('*') || config.origins.includes(origin.replace(/\/+$/, ''));
    if (!allowed) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    // Chrome's Private Network Access: a public page may call this LAN address only if we say so.
    if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
    return true;
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://box');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!cors(req, res)) return send(res, 403, { error: 'This origin may not use the box. Add it to YAXB_BOX_ORIGINS.' });
    if (req.method === 'OPTIONS') return send(res, 204);
    if (url.pathname === '/health') return send(res, 200, { ok: true, name: 'yaxb-box', version: VERSION });
    if (!tokenMatches(req.headers.authorization, config.token)) return send(res, 401, { error: 'The box token is missing or wrong.' });
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

  return {
    db,
    tls: Boolean(tls),
    server,
    listen: () =>
      new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          if (certServer) certServer.listen(config.certPort, config.host, resolve);
          else resolve();
        });
      }),
    address: () => server.address(),
    close: () =>
      new Promise((resolve) => {
        certServer?.close();
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections?.();
      }),
  };
}
