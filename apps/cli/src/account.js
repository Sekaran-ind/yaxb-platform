// This terminal's sign-in (IDN-41): `yaxb login` asks the site for a code, a person approves it on a
// device where they are signed in, and the terminal keeps its own credential in
// $YAXB_HOME/credentials.json, readable only by the user (0600). `yaxb logout` revokes it on the
// site and deletes the file. Signed in, the kiosk runs on the site: no provider keys here.
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { signInDevice } from '@sekaran-ind/yaxb-core/remote';

export const DEFAULT_SITE = 'https://anjalai.cc';

export function createAccount(home, { fetch: f = fetch } = {}) {
  const file = join(home, 'credentials.json');
  const read = () => {
    if (!existsSync(file)) return null;
    try {
      const c = JSON.parse(readFileSync(file, 'utf8'));
      return typeof c?.token === 'string' && typeof c?.site === 'string' ? c : null;
    } catch {
      return null;
    }
  };
  return {
    /** The saved credential, or null. */
    current: read,
    async login({ site = process.env.YAXB_SITE || DEFAULT_SITE, show, signal } = {}) {
      const base = new URL(site).origin;
      const name = `yaxb on ${hostname()}`.slice(0, 60);
      const { token, credential } = await signInDevice({ site: base, client: 'cli', name, show, fetch: f, signal });
      writeFileSync(file, JSON.stringify({ site: base, token, id: credential.id, name: credential.name, expires_at: credential.expires_at }, null, 2), { mode: 0o600 });
      chmodSync(file, 0o600);
      return { site: base, name: credential.name };
    },
    async logout() {
      const c = read();
      if (!c) return null;
      // Revoke it on the site; the file goes even if the site can't be reached.
      await f(`${c.site}/api/identity/devices/self`, { method: 'DELETE', headers: { Authorization: `Bearer ${c.token}`, Origin: c.site } }).catch(() => null);
      rmSync(file, { force: true });
      return { site: c.site };
    },
    async whoami() {
      const c = read();
      if (!c) return null;
      const res = await f(`${c.site}/api/identity/me`, { headers: { Authorization: `Bearer ${c.token}` } }).catch(() => null);
      const me = res?.ok ? await res.json().catch(() => null) : null;
      if (!me?.signedIn) return { site: c.site, name: c.name, label: 'signed out on the site: run `yaxb login` again' };
      return { site: c.site, name: me.account?.display_name || c.name, label: 'signed in' };
    },
  };
}
