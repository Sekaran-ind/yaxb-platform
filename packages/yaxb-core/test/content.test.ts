import { describe, expect, it } from "vitest";
import { kioskContent } from "../src/content/index.js";
import { compileJourney, createRunner, holds, render, conditionProblem } from "../src/journeys/index.js";
import { chunk, createNotebookRetriever, notebookFiles, notebookSchema } from "../src/notebook/index.js";
import { resolveActiveScreen, resolveLayout, resolveNavMode, screensFor } from "../src/screens/index.js";
import { compileService, servicesFor } from "../src/services/index.js";
import { parseMcpServers } from "../src/mcp/index.js";

describe("built-in content", () => {
  it("compiles with no problems", () => {
    expect(kioskContent.problems).toEqual([]);
    expect(kioskContent.skills.map((s) => s.name)).toContain("notebook-research");
    expect(kioskContent.journeys.length).toBeGreaterThanOrEqual(5);
    expect(kioskContent.services.length).toBeGreaterThanOrEqual(3);
  });
  it("offers fewer screens and services in the mini layout than the full kiosk", () => {
    const mini = screensFor(kioskContent.screens, "mini").map((s) => s.id);
    const full = screensFor(kioskContent.screens, "full").map((s) => s.id);
    expect(mini).toEqual(["transcript", "services", "notebook"]);
    expect(full).toContain("scorecard");
    expect(full).not.toContain("sandbox"); // removed: the services cover it
    expect(full).not.toContain("translate"); // hidden
    const tools = servicesFor(kioskContent.services, { layout: "mini" }).find((s) => s.id === "tools");
    expect(tools?.items.map((i) => i.key)).toEqual(["translate"]);
  });
});

describe("conditions and templates", () => {
  const scope = { answers: { pick: { mode: "device", n: 3 } }, steps: {}, context: {} };
  it("evaluates safe conditions", () => {
    expect(holds("answers.pick.mode == 'device'", scope)).toBe(true);
    expect(holds("answers.pick.n > 2 && !steps.x", scope)).toBe(true);
    expect(holds("answers.pick.missing || answers.pick.mode != 'device'", scope)).toBe(false);
  });
  it("refuses anything that isn't data, a literal or an operator", () => {
    expect(conditionProblem("constructor.constructor('x')()")).not.toBeNull();
    expect(conditionProblem("answers.a = 1")).not.toBeNull();
    expect(holds("answers.__proto__", scope)).toBe(false);
  });
  it("renders placeholders, keeping types for whole-value placeholders", () => {
    expect(render({ a: "{{answers.pick.n}}", b: "n={{answers.pick.n}}", c: "{{nope.x}}!" }, scope)).toEqual({ a: 3, b: "n=3", c: "!" });
  });
});

describe("journeys", () => {
  const yaml = `
kind: journey
id: demo
title: Demo
start: ask
steps:
  ask:
    ask: What?
    fields: [{ id: text, type: text, label: Text, required: true }, { id: tr, type: boolean, label: Translate, default: false }]
    next: [{ if: answers.ask.tr, to: translate }, { to: shout }]
  shout:
    service: demo.upper
    with: { text: "{{answers.ask.text}}" }
    next: done
  translate:
    service: demo.fail
    onError: continue
    next: done
  done:
    final: true
    result: { title: Done, text: "{{steps.shout.text}}{{steps.translate.error}}" }
`;
  it("refuses unknown steps, services, keys and bad conditions", () => {
    const bad = compileJourney(yaml.replace("to: shout", "to: nowhere").replace("demo.upper", "demo.nope").replace("final: true", "final: true\n    colour: red"), {
      services: ["demo.upper", "demo.fail"],
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.problems.join("\n")).toMatch(/no step 'nowhere'[\s\S]*no service 'demo.nope'[\s\S]*unknown key 'colour'/);
  });

  it("runs ask, branch, service and final steps; validates answers", async () => {
    const compiled = compileJourney(yaml, { services: ["demo.upper", "demo.fail"] });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const states: string[] = [];
    const runner = createRunner(compiled.journey, {
      services: {
        "demo.upper": async (input) => ({ text: String((input as { text: string }).text).toUpperCase() }),
        "demo.fail": async () => {
          throw new Error("offline model not loaded");
        },
      },
      onChange: (s) => states.push(s.status),
    });
    expect((await runner.start()).status).toBe("asking");
    expect(await runner.answer({})).toEqual({ problems: ["Text is required."] });
    const done = await runner.answer({ text: "hello" });
    expect(done).toMatchObject({ status: "done", result: { title: "Done", text: "HELLO", ok: true } });
    expect(states).toContain("running");

    const r2 = createRunner(compiled.journey, { services: { "demo.fail": async () => Promise.reject(new Error("offline model not loaded")) } });
    await r2.start();
    expect(await r2.answer({ text: "x", tr: true })).toMatchObject({ status: "done", result: { text: "offline model not loaded" } });
  });

  it("fails clearly when a surface lacks a service", async () => {
    const compiled = compileJourney(yaml);
    if (!compiled.ok) throw new Error("compile");
    const runner = createRunner(compiled.journey);
    await runner.start();
    expect(await runner.answer({ text: "x" })).toMatchObject({ status: "failed", error: '"demo.upper" isn\'t available here.' });
  });
});

describe("services", () => {
  it("checks items point at real screens and journeys", () => {
    const r = compileService({ kind: "service", id: "s", title: "S", items: [{ key: "a", label: "A", journey: "nope" }, { key: "b", label: "B" }] }, { journeys: ["x"] });
    expect(!r.ok && r.problems).toEqual(["item 'a': no journey 'nope'", "item 'b' needs a screen or a journey"]);
  });
});

describe("screens and adaptive nav", () => {
  it("picks a layout from the width unless the visitor chose one", () => {
    expect(resolveLayout(400)).toBe("mini");
    expect(resolveLayout(800)).toBe("pod");
    expect(resolveLayout(1400)).toBe("full");
    expect(resolveLayout(400, "full")).toBe("full");
  });
  it("resolves nav modes like AdaptiveSectionNav", () => {
    expect(resolveNavMode({ configMode: "panes", storedMode: "tabs" })).toBe("panes");
    expect(resolveNavMode({ configMode: "tabs", storedMode: "sidebar" })).toBe("sidebar");
    expect(resolveNavMode({ configMode: "tabs", storedMode: "bogus" })).toBe("tabs");
    expect(resolveActiveScreen([{ id: "a" }, { id: "b" }], "b")).toBe("b");
    expect(resolveActiveScreen([{ id: "a" }], "gone")).toBe("a");
  });
});

describe("notebook", () => {
  it("validates limits and builds the agent's files", () => {
    const nb = notebookSchema.parse({ id: "n", title: "T", sources: [{ id: "s1", title: "Doc", text: "Hello", addedAt: "2026-01-01" }] });
    const files = notebookFiles(nb);
    expect(Object.keys(files).sort()).toEqual(["/memories/AGENTS.md", "/notebook/README.md", "/notebook/sources/s1.md"]);
    expect(files["/notebook/README.md"]!.content.join("\n")).toContain("notebook:s1");
    expect(notebookSchema.safeParse({ id: "../x", title: "T" }).success).toBe(false);
  });
  it("chunks long text and finds passages", async () => {
    const text = `${"Intro. ".repeat(200)}\n\nFasting: stop eating six hours before the procedure.`;
    expect(chunk(text).length).toBeGreaterThan(1);
    const r = createNotebookRetriever({ id: "n", title: "T", memory: "", sources: [{ id: "s1", title: "Leaflet", mime: "text/plain", text, addedAt: "" }] });
    const [hit] = await r.search("when to stop eating", 2);
    expect(hit?.source).toBe("notebook:s1");
    expect(hit?.content).toContain("six hours");
  });
});

describe("MCP config", () => {
  it("accepts https servers and reports bad entries without throwing", () => {
    const { servers, problems } = parseMcpServers(JSON.stringify([{ id: "ok", label: "OK", url: "https://a.example/mcp" }, { id: "bad", label: "Bad", url: "http://10.0.0.1/mcp" }]));
    expect(servers.map((s) => s.id)).toEqual(["ok"]);
    expect(problems[0]).toMatch(/https/);
    expect(parseMcpServers("not json").problems).toEqual(["MCP_SERVERS is not valid JSON"]);
  });
});
