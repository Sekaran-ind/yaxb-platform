// Box connectors (CNX-4): systems on the office network (Tally first, then printers and devices)
// that only the box can reach. The box calls only connectors installed on it by whoever runs it
// (`yaxb-box connector add <file.json>`, the JSON the catalogue's "Download for the box" gives), with
// their secrets kept here (`yaxb-box connector secret <id> <NAME>`, the value read from stdin), so a
// kiosk can name a connector and an operation and give the input, never an address. Zero
// dependencies: the same request building as yaxb-core's connectors, in plain JavaScript.
//
//   { id, title, base, auth: { type: none|bearer|header|query, secret?, name? },
//     operations: [{ id, label?, method, path, query?, body?, format?: json|xml }] }

const ID = /^[a-z][a-z0-9-]{0,47}$/;
const SECRET = /^[A-Z][A-Z0-9_]{1,47}$/;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const CONNECTOR_TIMEOUT_MS = 10_000;
export const CONNECTOR_MAX_BYTES = 200_000;

export class ConnectorError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** A connector as installed, checked; throws with what's wrong. */
export function checkConnector(c) {
  const problems = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new ConnectorError('A connector is a JSON object.');
  if (!ID.test(String(c.id))) problems.push('id is lower-case words joined by -');
  if (typeof c.title !== 'string' || !c.title.trim()) problems.push('title is required');
  let u = null;
  try {
    u = new URL(c.base);
  } catch {
    problems.push('base is the system\'s http or https address');
  }
  if (u && u.protocol !== 'http:' && u.protocol !== 'https:') problems.push('base is http or https');
  if (u && (u.username || u.password)) problems.push('base holds no name or password: use auth and a secret');
  const auth = c.auth ?? { type: 'none' };
  if (!['none', 'bearer', 'header', 'query'].includes(auth.type)) problems.push('auth.type is none, bearer, header or query');
  if (auth.type !== 'none' && !SECRET.test(String(auth.secret))) problems.push('auth.secret is the secret\'s NAME');
  if ((auth.type === 'header' || auth.type === 'query') && !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(String(auth.name))) problems.push('auth.name is the header or query parameter');
  if (!Array.isArray(c.operations) || !c.operations.length) problems.push('operations lists at least one');
  else
    for (const o of c.operations) {
      if (!ID.test(String(o?.id))) problems.push('an operation needs an id');
      if (!METHODS.includes(o?.method)) problems.push(`operation ${o?.id}: method is one of ${METHODS.join(', ')}`);
      if (typeof o?.path !== 'string' || !o.path.startsWith('/')) problems.push(`operation ${o?.id}: path starts with /`);
      if (o?.format === 'xml' && typeof o.body !== 'string') problems.push(`operation ${o?.id}: an xml body is text`);
    }
  if (problems.length) throw new ConnectorError(problems.join('; '));
  return { id: c.id, title: c.title, base: c.base, auth: { type: auth.type, ...(auth.secret ? { secret: auth.secret } : {}), ...(auth.name ? { name: auth.name } : {}) }, operations: c.operations };
}

const xmlEscape = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));

/** {{input.x}} in text, each value passed through `each`. A whole-string placeholder keeps the value's type. */
function fill(value, input, each = asText) {
  if (typeof value === 'string') {
    const whole = /^\{\{\s*input\.([A-Za-z0-9_]+)\s*\}\}$/.exec(value);
    if (whole && each === asText) return input[whole[1]] ?? '';
    return value.replace(/\{\{\s*input\.([A-Za-z0-9_]+)\s*\}\}/g, (_, k) => each(input[k] ?? ''));
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, input, each));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, input, each)]));
  return value;
}

/** The request for an operation: the path's values URL-encoded, xml values escaped, the secret added last. */
export function buildRequest(c, opId, input, secrets) {
  const op = c.operations.find((o) => o.id === opId);
  if (!op) throw new ConnectorError(`The connector has no operation '${opId}'.`, 404);
  const url = new URL(c.base.replace(/\/+$/, '') + fill(op.path, input, (v) => encodeURIComponent(asText(v))));
  if (url.origin !== new URL(c.base).origin) throw new ConnectorError('The operation\'s path left the connector\'s address.');
  for (const [k, v] of Object.entries(op.query ?? {})) url.searchParams.set(k, asText(fill(v, input)));
  const headers = { Accept: 'application/json' };
  const secret = c.auth.secret ? secrets[c.auth.secret] : undefined;
  if (c.auth.type !== 'none' && !secret) throw new ConnectorError(`The secret ${c.auth.secret} isn't set on the box (yaxb-box connector secret ${c.id} ${c.auth.secret}).`, 412);
  if (c.auth.type === 'bearer') headers.Authorization = `Bearer ${secret}`;
  if (c.auth.type === 'header') headers[c.auth.name] = secret;
  if (c.auth.type === 'query') url.searchParams.set(c.auth.name, secret);
  const init = { method: op.method, headers, redirect: 'manual' };
  if (op.body !== undefined && op.format === 'xml') {
    headers['Content-Type'] = 'text/xml; charset=utf-8';
    headers.Accept = 'text/xml, application/xml, */*';
    init.body = fill(op.body, input, (v) => xmlEscape(asText(v)));
  } else if (op.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(fill(op.body, input));
  }
  return { url: url.href, init };
}

/** Call an installed connector's operation: no redirects, 10 s, 200 KB; the answer is data from outside. */
export async function callBoxConnector(c, opId, input, secrets, fetchImpl = fetch) {
  const { url, init } = buildRequest(c, opId, input, secrets);
  const started = Date.now();
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS) }).catch((e) => {
    throw new ConnectorError(e?.name === 'TimeoutError' ? 'The office system took too long to answer.' : 'The office system couldn\'t be reached.', 504);
  });
  if (res.status >= 300 && res.status < 400) throw new ConnectorError('The office system answered with a redirect, which connectors don\'t follow.', 502);
  const text = (await res.text()).slice(0, CONNECTOR_MAX_BYTES);
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* text or XML */
  }
  return { ok: res.ok, status: res.status, ms: Date.now() - started, untrusted: true, data };
}
