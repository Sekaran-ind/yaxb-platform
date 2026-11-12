import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  canInitiate,
  compileBundle,
  compileJourney,
  compileService,
  EXAMPLE_BUNDLE,
  formToJourney,
  formToService,
  journeyToForm,
  newJourneyForm,
  newServiceForm,
  parseDocument,
  questionnaireTemplate,
  compileQuestionnaire,
  roleLabel,
  serviceToForm,
  splitDocuments,
  toYaml,
} from "../src/index.js";

const docs = splitDocuments(EXAMPLE_BUNDLE).map((c) => load(c.text) as Record<string, unknown>);
const questionnaires = compileBundle(EXAMPLE_BUNDLE).questionnaires;

describe("service forms", () => {
  it("round-trip every example service through the form and YAML", () => {
    for (const doc of docs.filter((d) => d.kind === "service")) {
      const back = load(toYaml(formToService(serviceToForm(doc))));
      expect(back).toEqual(doc);
    }
  });

  it("build a service with roles from a new form", () => {
    const f = newServiceForm("clinic");
    f.title = "Clinic";
    f.roles = ["receptionist", "nurse"];
    f.items[0] = { ...f.items[0]!, key: "check-in", label: "Check in", target: "visit-check-in" };
    const doc = formToService(f);
    expect(doc).toEqual({ kind: "service", id: "clinic", title: "Clinic", roles: ["receptionist", "nurse"], items: [{ key: "check-in", label: "Check in", journey: "visit-check-in" }] });
    expect(compileService(doc, { journeys: ["visit-check-in"], roles: ["receptionist", "nurse"] }).ok).toBe(true);
    expect(compileService(doc, { roles: ["nurse"] }).ok).toBe(false);
  });
});

describe("journey forms", () => {
  it("round-trip every example journey: the compiled journey is the same", () => {
    for (const doc of docs.filter((d) => d.kind === "journey")) {
      const { form, unsupported } = journeyToForm(doc);
      expect(unsupported).toEqual([]);
      const r = formToJourney(form);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const a = compileJourney(doc, { questionnaires });
      const b = compileJourney(load(toYaml(r.doc)) as object, { questionnaires });
      expect(b).toEqual(a);
    }
  });

  it("start from a template that compiles once it has fields", () => {
    const f = newJourneyForm("hello");
    f.title = "Hello";
    f.steps[0]!.fieldsYaml = "- { id: name, type: text, label: Name }";
    const r = formToJourney(f);
    expect(r.ok && compileJourney(r.doc).ok).toBe(true);
    if (r.ok) expect(r.doc.roles).toEqual({ initiate: ["visitor"] });
  });

  it("report fields or with that aren't YAML of the right shape", () => {
    const f = newJourneyForm("x");
    f.steps[0]!.fieldsYaml = "id: not-a-list";
    expect(formToJourney(f)).toEqual({ ok: false, problems: ["step 'ask': fields must be a YAML list"] });
    f.steps[0]!.fieldsYaml = "- { id: [";
    const bad = formToJourney(f);
    expect(bad.ok).toBe(false);
  });

  it("name steps that combine kinds, which only YAML can edit", () => {
    const { unsupported } = journeyToForm({ steps: { a: { ask: "Q", fields: [], service: "agent.ask", next: "b" }, b: { final: true } } });
    expect(unsupported).toEqual(["a"]);
  });
});

describe("roles", () => {
  it("are checked against the catalogue on services and journeys", () => {
    const j = { kind: "journey", id: "j", title: "J", start: "d", roles: { initiate: ["visitor", "nurse"], complete: ["doctor"] }, steps: { d: { final: true } } };
    expect(compileJourney(j, { roles: ["nurse", "doctor"] }).ok).toBe(true);
    const r = compileJourney(j, { roles: ["nurse"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(["roles.complete: no role 'doctor'"]);
    expect(compileJourney({ ...j, roles: { start: ["x"] } }).ok).toBe(false);
    expect(compileJourney({ ...j, roles: { initiate: ["Bad Role"] } }).ok).toBe(false);
  });

  it("decide who may start a journey", () => {
    expect(canInitiate({})).toBe(true);
    expect(canInitiate({ roles: { initiate: ["visitor"] } })).toBe(true);
    expect(canInitiate({ roles: { initiate: ["nurse"] } })).toBe(false);
    expect(canInitiate({ roles: { initiate: ["nurse"] } }, ["moderator", "nurse"])).toBe(true);
    expect(roleLabel("administrator")).toBe("Admin");
    expect(roleLabel("front-desk")).toBe("Front desk");
  });

  it("warn when a journey's roles don't take part in its service", () => {
    const b = compileBundle([
      "kind: service\nid: s\ntitle: S\nroles: [nurse]\nitems:\n  - { key: a, label: A, journey: j }\n",
      "kind: journey\nid: j\ntitle: J\nstart: d\nroles: { initiate: [visitor], complete: [doctor] }\nsteps:\n  d: { final: true }\n",
    ]);
    expect(b.ok).toBe(true);
    expect(b.problems.map((p) => p.message)).toEqual(["role 'doctor' doesn't take part in service 's'"]);
  });
});

describe("questionnaire YAML", () => {
  it("has a template that compiles, and parseDocument explains bad input", () => {
    expect(compileQuestionnaire(questionnaireTemplate("intake")).ok).toBe(true);
    expect(parseDocument("- a\n- b")).toEqual({ ok: false, error: "The YAML must be one mapping (key: value lines)." });
    expect(parseDocument("a: [").ok).toBe(false);
  });
});
