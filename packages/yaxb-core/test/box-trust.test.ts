// The site and the box agree (IDN-42): a box token the identity service issues verifies in the box's
// own offline check (apps/box/src/trust.js), and a revoked device's doesn't, after the box's next check.
import { describe, expect, it } from "vitest";
import { createIdentityService, createMemoryIdentityStore } from "../src/identity/index.js";
// @ts-expect-error: the box is plain JavaScript with no type declarations.
import { verifyBoxToken } from "../../../apps/box/src/trust.js";

describe("box tokens", () => {
  it("are verified by the box offline, until revoked", async () => {
    const id = createIdentityService(createMemoryIdentityStore(), { secret: "test-secret-0123456789", issuer: "https://anjalai.cc" });
    const r = await id.oidcSignIn({ provider: "google", subject: "s", email: "a@b.in", emailVerified: true, consent: true });
    if (!("session" in r)) throw new Error();
    const me = r.account.id;
    const phone = await id.deviceStart({ client: "voice", name: "Phone" });
    await id.deviceApprove(me, 2, phone.user_code, true);
    const p = await id.devicePoll(phone.device_code);
    if (p.status !== "approved") throw new Error();

    const fromSession = await id.boxToken(me, r.session.id, 2);
    const fromPhone = await id.boxToken(me, `dev:${p.credential.id}`, 2);
    let trust = await id.boxTrust(me);
    expect(verifyBoxToken(fromSession.token, trust)?.sub).toBe(me);
    expect(verifyBoxToken(fromPhone.token, trust)?.sid).toBe(`dev:${p.credential.id}`);
    // Another account's box doesn't take it.
    expect(verifyBoxToken(fromSession.token, { ...trust, account: "someone-else" })).toBeNull();

    // The phone is lost: after the box's next check, only its token stops.
    await id.revokeDeviceCredential(me, p.credential.id);
    trust = await id.boxTrust(me);
    expect(trust.revoked).toContain(`dev:${p.credential.id}`);
    expect(verifyBoxToken(fromPhone.token, trust)).toBeNull();
    expect(verifyBoxToken(fromSession.token, trust)?.sub).toBe(me);
  });
});
