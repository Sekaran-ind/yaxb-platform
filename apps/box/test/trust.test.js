// The box checks people offline (IDN-42): box tokens signed by the site, checked with the keys and
// the revocation list the box keeps. Real ES256 keys from node:crypto.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBoxServer } from '../src/server.js';
import { createSiteLink, verifyBoxToken } from '../src/trust.js';

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function keyPair(kid) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' } };
}
function token(k, claims) {
  const head = enc({ alg: 'ES256', kid: k.jwk.kid, typ: 'JWT' });
  const body = enc(claims);
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: k.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const now = 1_800_000_000;
const k1 = keyPair('k1');
const stranger = keyPair('k1');
const trust = { account: 'acct-1', issuer: 'https://anjalai.cc', audience: 'yaxb-box', keys: [k1.jwk], revoked: ['dev:lost-phone'] };
const good = { iss: 'https://anjalai.cc', aud: 'yaxb-box', sub: 'acct-1', sid: 'sess-1', lvl: 3, iat: now, exp: now + 7 * 86400 };

test('verifies a box token offline, and refuses what it shouldn\'t trust', () => {
  assert.equal(verifyBoxToken(token(k1, good), trust, now)?.sub, 'acct-1');
  assert.equal(verifyBoxToken(token(stranger, good), trust, now), null, 'signed by another key');
  assert.equal(verifyBoxToken(token(k1, { ...good, aud: 'something-else' }), trust, now), null);
  assert.equal(verifyBoxToken(token(k1, { ...good, sub: 'acct-2' }), trust, now), null, 'another account');
  assert.equal(verifyBoxToken(token(k1, { ...good, exp: now - 1 }), trust, now), null, 'expired');
  assert.equal(verifyBoxToken(token(k1, { ...good, sid: 'dev:lost-phone' }), trust, now), null, 'revoked device');
  assert.equal(verifyBoxToken(token(k1, good), null, now), null, 'no trust kept');
  const t = token(k1, good).split('.');
  assert.equal(verifyBoxToken(`${t[0]}.${enc({ ...good, sub: 'acct-1', lvl: 4 })}.${t[2]}`, trust, now), null, 'tampered');
  assert.equal(verifyBoxToken('not.a.token', trust, now), null);
});

test('the server takes a verified box token, keeps the shared token, and refreshes trust (or keeps it offline)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'box-trust-'));
  try {
    let online = true;
    let calls = 0;
    const fake = async (url, init) => {
      calls++;
      if (!online) throw new Error('offline');
      assert.equal(init.headers.Authorization, 'Bearer anj_dev_box');
      assert.match(String(url), /\/api\/identity\/box\/trust$/);
      return new Response(JSON.stringify({ ...trust, revoked: [] }), { status: 200 });
    };
    const file = join(dir, 'site.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, JSON.stringify({ site: 'https://anjalai.cc', token: 'anj_dev_box', trust: null }));
    const link = createSiteLink(file, { fetch: fake });
    assert.equal(await link.refresh(), true);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    online = false;
    assert.equal(await link.refresh(), false, 'offline');
    assert.deepEqual(link.trust.keys, [k1.jwk], 'the kept trust stays while offline');
    assert.ok(calls >= 2);

    const box = createBoxServer({ port: 0, certPort: 0, host: '127.0.0.1', dbPath: join(dir, 'box.sqlite3'), token: '', origins: [], tlsCertPath: '', tlsKeyPath: '' }, { link });
    await box.listen();
    const at = `http://127.0.0.1:${box.address().port}/v1/notebooks`;
    const live = { ...good, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
    assert.equal((await fetch(at, { headers: { Authorization: `Bearer ${token(k1, live)}` } })).status, 200);
    assert.equal((await fetch(at, { headers: { Authorization: `Bearer ${token(stranger, live)}` } })).status, 401);
    assert.equal((await fetch(at)).status, 401);
    await box.close();
    assert.throws(() => createBoxServer({ port: 0, dbPath: join(dir, 'b2.sqlite3'), token: '', origins: [] }, { link: createSiteLink(join(dir, 'none.json')) }), /Sign the box in/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
