// The Legal Guardian (CON-1..8): facts, flags, drafts, the model's rewrite, and the consent block.
import { describe, expect, it } from "vitest";
import { compileBundle, consentFormFor, parseDocument, serviceConsent } from "@sekaran-ind/yaxb-journeys";
import { createKiosk } from "../src/agent/index.js";
import { checkRewrite, consentFacts, draftConsent, guardianFlags, sensitivityOf } from "../src/guardian/index.js";
import { JOURNEY_SERVICES } from "../src/content/index.js";
import { createMemoryModerationStore, createMemoryThreadStore } from "../src/stores/index.js";
import { ScriptedModel } from "./scripted-model.js";

const YAML = `kind: service
id: city-run
title: City run
roles:
  - { id: marshal, label: Marshal }
  - { id: medic, label: Medic }
journeys:
  - id: register
    title: Register
    roles: { complete: [marshal] }
    screens:
      - id: you
        questions:
          - { id: name, type: text, label: Your name, required: true }
          - { id: mobile, type: text, label: Mobile, entity: phone }
          - { id: aadhaar, type: text, label: Aadhaar number }
          - { id: conditions, type: textarea, label: Medical conditions }
      - id: check
        role: medic
        questions:
          - { id: fit, type: boolean, label: Fit to run }
  - id: incident
    title: Report an incident
    roles: { initiate: [marshal], complete: [medic] }
    screens:
      - id: what
        questions:
          - { id: where, type: text, label: Where }
`;
const doc = () => {
  const b = compileBundle(YAML, { services: JOURNEY_SERVICES });
  expect(b.ok).toBe(true);
  const p = parseDocument(YAML);
  if (!p.ok) throw new Error(p.error);
  return p.doc;
};

describe("the Legal Guardian", () => {
  it("reads what each role gives, sees and who handles it", () => {
    const f = consentFacts(doc(), { storage: "none" });
    const visitor = f.roles.find((r) => r.role === "visitor")!;
    expect(visitor.starts).toEqual(["Register"]);
    expect(visitor.gives.map((g) => g.label)).toEqual(["Your name", "Mobile", "Aadhaar number", "Medical conditions"]);
    expect(visitor.seenBy).toEqual(["Marshal", "Medic"]);
    const medic = f.roles.find((r) => r.role === "medic")!;
    expect(medic.answers).toEqual(["Register"]);
    expect(medic.completes).toEqual(["Report an incident"]);
    expect(medic.sees.map((g) => g.label)).toContain("Medical conditions");
    const marshal = f.roles.find((r) => r.role === "marshal")!;
    expect(marshal.starts).toEqual(["Report an incident"]);
    expect(marshal.gives.map((g) => g.label)).toEqual(["Where"]);
  });

  it("knows sensitive questions", () => {
    expect(sensitivityOf({ id: "a", type: "text", label: "Aadhaar number" })).toContain("identity");
    expect(sensitivityOf({ id: "c", type: "textarea", label: "Medical conditions" })).toEqual(expect.arrayContaining(["health", "free-text"]));
    expect(sensitivityOf({ id: "p", type: "text", label: "Card number" })).toContain("money");
    expect(sensitivityOf({ id: "fee", type: "number", label: "Fee paid", entity: "money" })).not.toContain("money");
  });

  it("flags ID numbers and health details for the reviewer", () => {
    const flags = guardianFlags(consentFacts(doc()));
    expect(flags.map((f) => f.level)).toEqual(expect.arrayContaining(["warning"]));
    expect(flags.some((f) => /ID numbers \(aadhaar number\)/.test(f.message))).toBe(true);
    expect(flags.some((f) => /health \(medical conditions\)/.test(f.message))).toBe(true);
  });

  it("drafts a form per role, in plain words, valid as the service's consent block", () => {
    const server = (retainDays?: number) => JSON.stringify(draftConsent(consentFacts(doc(), { storage: "server", retainDays })));
    expect(server()).toContain("for 30 days after it is made, then deleted");
    expect(server(2555)).toContain("for 2555 days after it is made, then deleted");
    const c = draftConsent(consentFacts(doc(), { storage: "none", relayHours: 48 }));
    expect(c.forms.map((f) => f.role)).toEqual(["visitor", "marshal", "medic"]);
    const visitor = c.forms[0]!;
    expect(visitor.points[0]).toBe("City run asks for your name, mobile, aadhaar number and medical conditions.");
    expect(visitor.points[1]).toMatch(/^The marshal and the medic see what you give/);
    expect(c.forms[2]!.points[1]).toMatch(/^You will see what people give: name, mobile, /);
    expect(visitor.points.join(" ")).toMatch(/up to 48 hours/);
    expect(c.forms[2]!.title).toBe("Your duties as a medic");
    expect(c.forms[2]!.points.join(" ")).toMatch(/never copy, share or keep it elsewhere/);
    // It round-trips through the service's own check.
    const problems: string[] = [];
    expect(serviceConsent(c, new Set(["visitor", "marshal", "medic"]), problems)).toEqual(c);
    expect(problems).toEqual([]);
    const withConsent = compileBundle(`${YAML}consent:\n  version: 1\n  forms:\n${c.forms.map((f) => `    - role: ${f.role}\n      title: "${f.title}"\n      agree: "${f.agree}"\n      points:\n${f.points.map((p) => `        - ${JSON.stringify(p)}`).join("\n")}`).join("\n")}\n`, { services: JOURNEY_SERVICES });
    expect(withConsent.problems).toEqual([]);
  });

  it("refuses a bad consent block, and picks the right form for a person", () => {
    const problems: string[] = [];
    serviceConsent({ version: 1, forms: [{ role: "judge", title: "x", points: ["a"] }] }, new Set(["visitor", "marshal"]), problems);
    expect(problems[0]).toMatch(/isn't one of this service's roles/);
    const c = draftConsent(consentFacts(doc()));
    expect(consentFormFor(c, [])?.role).toBe("visitor");
    expect(consentFormFor(c, ["medic"], ["medic"])?.role).toBe("medic");
    expect(consentFormFor(c, ["marshal"], ["marshal"])?.role).toBe("marshal");
    expect(consentFormFor(c, [], ["marshal"])).toBeNull();
  });

  it("keeps the model's wording only one point for one", () => {
    const draft = draftConsent(consentFacts(doc()));
    const ok = { forms: draft.forms.map((f) => ({ ...f, points: f.points.map((p) => `Plainly: ${p}`) })) };
    expect(checkRewrite(draft, ok).rewritten).toBe(3);
    const short = { forms: draft.forms.map((f) => ({ ...f, points: f.points.slice(1) })) };
    const r = checkRewrite(draft, short);
    expect(r.rewritten).toBe(0);
    expect(r.consent.forms).toEqual(draft.forms);
  });

  it("kiosk.guardian: drafts without a model, rewrites with one, and raises the version on new wording", async () => {
    const draft = draftConsent(consentFacts(doc()));
    const rewrite = { forms: draft.forms.map((f) => ({ ...f, points: f.points.map((p) => `Simply put, ${p}`) })) };
    const kiosk = createKiosk({
      env: { ANTHROPIC_API_KEY: "test" },
      threads: createMemoryThreadStore(),
      moderation: createMemoryModerationStore(),
      modelFactory: async () => new ScriptedModel([{ text: "(structured attempt)" }, { text: JSON.stringify(rewrite) }]),
      webSearch: null,
      embed: null,
    });
    const plain = await kiosk.guardian({ yaml: YAML });
    expect("consent" in plain && plain.via).toBe("draft");
    expect("consent" in plain && plain.consent.version).toBe(1);
    const r = await kiosk.guardian({ yaml: `${YAML}consent: { version: 3, forms: [{ role: visitor, title: Old, points: [old], agree: OK }] }\n`, selection: { provider: "anthropic", model: "claude-haiku-5-5", temperature: 0.2 } });
    if (!("consent" in r)) throw new Error(r.error);
    expect(r.via).toBe("assistant");
    expect(r.consent.version).toBe(4);
    expect(r.consent.forms[0]!.points[0]).toMatch(/^Simply put, /);
    expect(await kiosk.guardian({ yaml: "" })).toEqual({ error: "Send the service's YAML." });
  });
});
