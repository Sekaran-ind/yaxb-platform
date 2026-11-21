import { describe, expect, it } from "vitest";
import { accessOf, accessProblems, compileBundle, mayAnswer, redactRun } from "../src/index.js";

const starter = { starter: true, roles: [] as string[] };
const nurse = { starter: false, roles: ["nurse"] };
const doctor = { starter: false, roles: ["doctor"] };
const clerk = { starter: false, roles: ["clerk"] };

describe("step access (rwx)", () => {
  it("without access, a step works as before: its role (or the starter) answers, everyone who sees the case reads", () => {
    expect(accessOf({ role: "nurse" }, nurse)).toEqual({ r: true, w: true, x: true });
    expect(accessOf({ role: "nurse" }, starter)).toEqual({ r: true, w: false, x: false });
    expect(accessOf({}, starter)).toEqual({ r: true, w: true, x: true });
    expect(accessOf({}, nurse)).toEqual({ r: true, w: false, x: false });
    expect(mayAnswer({ role: "nurse" }, nurse)).toBe(true);
    expect(mayAnswer({ role: "nurse" }, doctor)).toBe(false);
  });

  it("with access, only what it lists is granted, plus the defaults of subjects it doesn't list", () => {
    const step = { role: "nurse", access: { doctor: "r", clerk: "rw" } };
    expect(accessOf(step, nurse)).toEqual({ r: true, w: true, x: true }); // the step's role, unlisted: rwx
    expect(accessOf(step, doctor)).toEqual({ r: true, w: false, x: false });
    expect(accessOf(step, clerk)).toEqual({ r: true, w: true, x: false });
    expect(accessOf(step, starter)).toEqual({ r: true, w: false, x: false }); // the starter reads a step someone else answers
    expect(accessOf(step, { starter: false, roles: ["porter"] })).toEqual({ r: false, w: false, x: false });
    expect(mayAnswer(step, clerk)).toBe(true); // access can let another role answer
  });

  it("a subject it lists replaces its default, and any is everyone", () => {
    const step = { role: "nurse", access: { nurse: "r", starter: "-", any: "r" } as Record<string, string> };
    expect(accessOf({ role: "nurse", access: { nurse: "r" } }, nurse)).toEqual({ r: true, w: false, x: false });
    expect(accessOf({ role: "nurse", access: { starter: "-" } }, starter)).toEqual({ r: false, w: false, x: false }); // "-" takes the default away
    expect(accessOf({ role: "nurse", access: { starter: "w" } }, starter)).toEqual({ r: false, w: true, x: false });
    expect(accessOf({ access: { any: "r" } }, doctor)).toEqual({ r: true, w: false, x: false });
    expect(step.access.any).toBe("r");
  });

  it("is checked: bits, subjects, roles, and what a step can do", () => {
    const q = { questions: true, service: false };
    expect(accessProblems("s", { nurse: "rw", starter: "r", any: "r" }, q, ["nurse"])).toEqual([]);
    expect(accessProblems("s", [], q)).toHaveLength(1);
    expect(accessProblems("s", { nurse: "rwxr" }, q)).toHaveLength(1);
    expect(accessProblems("s", { nurse: "wr" }, q)).toHaveLength(1);
    expect(accessProblems("s", { nurse: "" }, q)).toHaveLength(1);
    expect(accessProblems("s", { nurse: "-" }, q)).toEqual([]);
    expect(accessProblems("s", { visitor: "r" }, q)[0]).toMatch(/use any/);
    expect(accessProblems("s", { ghost: "r" }, q, ["nurse"])[0]).toMatch(/isn't one of this service's roles/);
    expect(accessProblems("s", { nurse: "w" }, { questions: false, service: false })[0]).toMatch(/only a step with questions/);
    expect(accessProblems("s", { nurse: "x" }, q)[0]).toMatch(/calls a service/);
    expect(accessProblems("s", { nurse: "rx" }, { questions: false, service: true })).toEqual([]);
  });

  it("is read from a service's screens, and a bad one is a problem", () => {
    const yaml = (access: string) => `kind: service
id: clinic
title: Clinic
roles: [{ id: nurse, label: Nurse }, { id: doctor, label: Doctor }]
journeys:
  - id: visit
    title: Visit
    roles: { initiate: [visitor], complete: [doctor] }
    screens:
      - id: symptoms
        title: Symptoms
        questions: [{ id: what, type: text, label: What }]
      - id: triage
        title: Triage
        role: nurse
        access: ${access}
        questions: [{ id: bp, type: text, label: Blood pressure }]
      - id: done
        result: { title: Done }
`;
    const ok = compileBundle(yaml("{ nurse: rw, doctor: r }"));
    expect(ok.problems.filter((p) => p.level === "error")).toEqual([]);
    expect(ok.journeys[0]!.steps.triage!.access).toEqual({ nurse: "rw", doctor: "r" });
    const bad = compileBundle(yaml("{ porter: r }"));
    expect(bad.problems.some((p) => p.level === "error" && /porter/.test(p.message))).toBe(true);
  });

  it("leaves out the steps an actor may not read, and says which; administrators read everything", () => {
    const steps = { a: { access: { nurse: "r" } as Record<string, string> }, b: {} };
    const run = { current: null, answers: { a: { x: 1 }, b: { y: 2 } }, steps: { a: "r" }, trail: [] };
    expect(redactRun(steps, run, doctor)).toMatchObject({ hidden: ["a"], run: { answers: { b: { y: 2 } }, steps: {} } });
    expect(redactRun(steps, run, nurse).hidden).toEqual([]);
    expect(redactRun(steps, run, { ...doctor, admin: true }).hidden).toEqual([]);
  });
});

describe("the designer keeps a screen's access", () => {
  it("round-trips it through the design, so saving from the designer doesn't drop it", async () => {
    const { designFromDoc, designToDoc, parseDocument } = await import("../src/index.js");
    const yaml = `kind: service
id: clinic
title: Clinic
roles: [{ id: nurse, label: Nurse }]
journeys:
  - id: visit
    title: Visit
    screens:
      - id: triage
        title: Triage
        role: nurse
        access: { nurse: rw, starter: "-" }
        questions: [{ id: bp, type: text, label: BP }]
      - id: done
        result: { title: Done }
`;
    const parsed = parseDocument(yaml);
    if (!parsed.ok) throw new Error(parsed.error);
    const { design, unsupported } = designFromDoc(parsed.doc);
    expect(unsupported).toEqual([]);
    expect(design.journeys[0]!.screens[0]!.access).toEqual({ nurse: "rw", starter: "-" });
    const out = designToDoc(design);
    if (!out.ok) throw new Error(out.problems.join("; "));
    const doc = out.doc as { journeys: { screens: { access?: unknown }[] }[] };
    expect(doc.journeys[0]!.screens[0]!.access).toEqual({ nurse: "rw", starter: "-" });
    expect(doc.journeys[0]!.screens[1]!.access).toBeUndefined();
  });
});
