// The box checks people offline (IDN-42). It is signed in to the site once, like a terminal
// (`yaxb-box login`): a person approves its code, and the box keeps its own credential. With it, the
// box fetches its owner's trust every few minutes: the site's signing keys and the sessions and
// devices revoked lately. People's browsers and terminals get a box token from the site (an ES256
// token for a week); the box verifies it with the keys it keeps, so people signed in recently keep
// working while the internet is down, and a revoked device stops at the next check.
// Node built-ins only.
import { createPublicKey, verify } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * A box token's claims when it is genuine and holds: signed by one of the trusted keys, for this
 * box's audience and owner, in date, and not from a revoked session or device. Otherwise null.
 */
export function verifyBoxToken(token, trust, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!trust || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = JSON.parse(b64(parts[0]).toString('utf8'));
    claims = JSON.parse(b64(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'ES256') return null;
  const jwk = (trust.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  let ok = false;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    ok = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, b64(parts[2]));
  } catch {
    return null;
  }
  if (!ok) return null;
  if (claims.iss !== trust.issuer || claims.aud !== trust.audience || claims.sub !== trust.account) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
  if ((trust.revoked || []).includes(claims.sid)) return null;
  return claims;
}

/** The box's link to the site: its credential and the last trust it fetched, kept in one file (0600). */
export function createSiteLink(file, { fetch: f = fetch } = {}) {
  let state = null;
  if (file && existsSync(file)) {
    try {
      state = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      state = null;
    }
  }
  const save = () => {
    writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
    chmodSync(file, 0o600);
  };
  return {
    get linked() {
      return Boolean(state?.site && state?.token);
    },
    get trust() {
      return state?.trust ?? null;
    },
    /** Fetch the owner's trust; when the site can't be reached, the kept one stays (offline). */
    async refresh() {
      if (!state?.site || !state?.token) return false;
      try {
        const res = await f(`${state.site}/api/identity/box/trust`, { headers: { Authorization: `Bearer ${state.token}` } });
        if (res.status === 401) {
          // The box itself was signed out on the site: nobody's token is trusted any more.
          state = { ...state, trust: null };
          save();
          return false;
        }
        if (!res.ok) return false;
        state = { ...state, trust: await res.json() };
        save();
        return true;
      } catch {
        return false;
      }
    },
    /** Sign the box in with a code a person approves (client "box"). */
    async login({ site, name, show, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
      const base = new URL(site).origin;
      const post = async (path, body) => {
        const res = await f(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
        return { status: res.status, body: (await res.json().catch(() => ({}))) || {} };
      };
      const start = await post('/api/identity/device/start', { client: 'box', name });
      if (start.status !== 200) throw new Error(start.body.error || `The site answered ${start.status}.`);
      show(start.body);
      const until = Date.now() + start.body.expires_in * 1000;
      while (Date.now() < until) {
        await sleep(start.body.interval * 1000);
        const r = await post('/api/identity/device/token', { device_code: start.body.device_code });
        if (r.status !== 200) throw new Error(r.body.error || `The site answered ${r.status}.`);
        if (r.body.status === 'approved') {
          state = { site: base, token: r.body.token, id: r.body.credential.id, trust: null };
          save();
          await this.refresh();
          return { site: base, name: r.body.credential.name };
        }
        if (r.body.status === 'denied') throw new Error('The sign-in was turned down.');
        if (r.body.status === 'expired') break;
      }
      throw new Error('The code expired before it was approved. Run it again.');
    },
  };
}
