// Connector secrets (CNX-3) are sealed for their own purpose, with SEALING_SECRET when it is set and
// SESSION_SECRET otherwise. Keeping them apart means rotating the session secret (which signs cookies)
// no longer destroys the connectors' passwords; setting SEALING_SECRET later still opens what was
// sealed under the session secret (the original single key).
import { seal, unseal } from "@sekaran-ind/yaxb-core/identity";
import { settings, type Bindings } from "./env";

const PURPOSE = "connector";
const current = (env: Bindings) => settings(env).SEALING_SECRET ?? settings(env).SESSION_SECRET;

export const sealConnectorSecret = (env: Bindings, value: string) => seal(current(env), value, PURPOSE);

export async function unsealConnectorSecret(env: Bindings, sealed: string): Promise<string> {
  const s = settings(env);
  const tries = [...new Set([current(env), s.SESSION_SECRET])];
  let last: unknown;
  for (const secret of tries) {
    try {
      return await unseal(secret, sealed);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
