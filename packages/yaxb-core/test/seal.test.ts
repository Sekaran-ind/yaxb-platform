import { describe, expect, it } from "vitest";
import { canOpen, generateKeyPair, open, rewrap, seal, withoutReader } from "../src/seal/index.js";

describe("sealing", () => {
  it("opens for each reader, and for nobody else", async () => {
    const [a, b, outsider] = await Promise.all([generateKeyPair("dev-a"), generateKeyPair("dev-b"), generateKeyPair("dev-x")]);
    const sealed = await seal({ pay: "4111 1111", n: 3 }, "case-1|billing", [a, b]);
    expect(JSON.stringify(sealed)).not.toContain("4111");
    expect(await open(sealed, "case-1|billing", a)).toEqual({ pay: "4111 1111", n: 3 });
    expect(await open(sealed, "case-1|billing", b)).toEqual({ pay: "4111 1111", n: 3 });
    expect(await open(sealed, "case-1|billing", outsider)).toBeNull();
    expect(canOpen(sealed, "dev-a")).toBe(true);
    expect(canOpen(sealed, "dev-x")).toBe(false);
    // A reader's id with another key behind it doesn't open it either.
    expect(await open(sealed, "case-1|billing", { id: "dev-a", privateKey: outsider.privateKey })).toBeNull();
  });

  it("is bound to its case and step, and can't be changed", async () => {
    const a = await generateKeyPair("dev-a");
    const sealed = await seal({ x: 1 }, "case-1|billing", [a]);
    expect(await open(sealed, "case-2|billing", a)).toBeNull();
    expect(await open(sealed, "case-1|other", a)).toBeNull();
    const flipped = { ...sealed, ct: sealed.ct.slice(0, -2) + (sealed.ct.endsWith("AA") ? "BB" : "AA") };
    expect(await open(flipped, "case-1|billing", a)).toBeNull();
    const swapped = { ...sealed, keys: { "dev-b": sealed.keys["dev-a"]! } };
    const b = await generateKeyPair("dev-b");
    expect(await open(swapped, "case-1|billing", b)).toBeNull();
  });

  it("lets a reader add readers, and take one out of later copies", async () => {
    const [a, late] = await Promise.all([generateKeyPair("dev-a"), generateKeyPair("dev-late")]);
    const sealed = await seal("secret", "c|s", [a]);
    expect(await open(sealed, "c|s", late)).toBeNull();
    const wider = (await rewrap(sealed, "c|s", a, [late]))!;
    expect(await open(wider, "c|s", late)).toBe("secret");
    expect(await rewrap(sealed, "c|s", late, [late])).toBeNull(); // only a reader can add readers
    const narrower = withoutReader(wider, "dev-a");
    expect(await open(narrower, "c|s", a)).toBeNull();
    expect(await open(narrower, "c|s", late)).toBe("secret");
  });

  it("refuses to seal for nobody, and keeps a private key out of reach", async () => {
    await expect(seal("x", "c|s", [])).rejects.toThrow(/Nobody/);
    const k = await generateKeyPair("k");
    await expect(crypto.subtle.exportKey("jwk", k.privateKey)).rejects.toThrow();
    const backup = await generateKeyPair("k2", { extractable: true });
    expect((await crypto.subtle.exportKey("jwk", backup.privateKey)).d).toBeTruthy();
  });
});
