// The kiosk understanding its own commands (CMD-1..6, 10): recognised by meaning with real MiniLM
// vectors, by words without a model, refused when out of bounds, and never confused with questions.
import { describe, expect, it } from "vitest";
import { profileSchema } from "../src/accounts/index.js";
import { aboutKiosk, allCommands, COMMAND_THRESHOLDS, confirmText, journeyCommands, KIOSK_COMMANDS, languageIn, matchCommand, profileFields, profilePatch } from "../src/commands/index.js";
import { kioskContent } from "../src/content/index.js";
import { matchFields } from "../src/journeys/index.js";
import type { Embed } from "../src/knowledge/semantic.js";
import fixture from "./fixtures/command-embeddings.json" with { type: "json" };

const unpack = (b64: string) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return Array.from(new Float32Array(bytes.buffer));
};
const vectors = new Map<string, number[]>([
  ...Object.entries(fixture.examples).map(([k, v]) => [k, unpack(v)] as [string, number[]]),
  ...fixture.commands.map((c) => [c.text, unpack(c.vector)] as [string, number[]]),
  ...fixture.questions.map((q) => [q.text, unpack(q.vector)] as [string, number[]]),
]);
/** Real MiniLM vectors from the fixture; a text it doesn't have is a test error. */
const realEmbed: Embed = async (texts) =>
  texts.map((t) => {
    const v = vectors.get(t);
    if (!v) throw new Error(`No fixture vector for "${t}": regenerate test/fixtures/command-embeddings.json`);
    return v;
  });
const commands = allCommands(kioskContent.journeys);
const real = { commands, embed: realEmbed, thresholds: COMMAND_THRESHOLDS.minilm };

describe("recognising commands by meaning (real MiniLM vectors)", () => {
  it("has a vector for every example in the catalogue (regenerate the fixture after changing it)", () => {
    for (const c of commands) for (const e of c.examples) expect(vectors.has(e), e).toBe(true);
  });

  it("recognises commands phrased differently from the catalogue", async () => {
    for (const { text, expect: want } of fixture.commands) expect((await matchCommand(text, real))?.command.id, text).toBe(want);
  });

  it("never takes an ordinary question for a command", async () => {
    for (const { text } of fixture.questions) expect(await matchCommand(text, real), text).toBeNull();
  });
});

describe("recognising commands without a model", () => {
  it("matches every word of an example, and nothing looser", async () => {
    expect((await matchCommand("please open my notebook", { commands }))?.command.id).toBe("open.screen.notebook");
    expect((await matchCommand("go to settings", { commands }))?.command.id).toBe("open.settings");
    expect(await matchCommand("what is the capital of India", { commands })).toBeNull();
    expect(await matchCommand("my notebook says the appointment is at 3", { commands })).toBeNull();
  });

  it("treats a long message as a question, whatever it mentions", async () => {
    const long = "I wanted to ask whether I should open my notebook before the appointment because the doctor said something about the settings of the machine and I am not sure what that means";
    expect(await matchCommand(long, { commands })).toBeNull();
  });
});

describe("what commands may do", () => {
  it("only change what Settings can: language, answer mode, web search, voice, layout, speech rate", () => {
    for (const c of KIOSK_COMMANDS) {
      const e = typeof c.effect === "function" ? c.effect("switch to Tamil") : c.effect;
      if (e?.type !== "settings") continue;
      for (const k of Object.keys(e.agent ?? {})) expect(["language", "knowledge"]).toContain(k);
      for (const k of Object.keys(e.agent?.knowledge ?? {})) expect(["answers", "web"]).toContain(k);
      for (const k of Object.keys(e.kiosk ?? {})) expect(["speakResponses", "layout", "speechRateDelta"]).toContain(k);
    }
  });

  it("refuse keys, escalation, safety rules and other people's data", async () => {
    const m = await matchCommand("turn the escalation off", real);
    expect(m?.effect.type).toBe("refuse");
    expect((m?.effect as { reason: string }).reason).toContain("organisation running the kiosk");
  });

  it("ask before changing anything, but not before opening a screen", () => {
    for (const c of KIOSK_COMMANDS) {
      const e = typeof c.effect === "function" ? c.effect("switch to Tamil") : c.effect;
      if (e?.type === "settings" || (e?.type === "profile" && e.action !== "open")) expect(c.confirm, c.id).toBe(true);
      if (e?.type === "open-screen" || e?.type === "open-settings" || e?.type === "about") expect(c.confirm, c.id).toBe(false);
    }
  });

  it("read the language from the words, in English or the language's own script", async () => {
    expect(languageIn("switch to Tamil please")).toBe("tam_Taml");
    expect(languageIn("தமிழில் பேசு")).toBeNull(); // the inflected form isn't the name itself …
    expect(languageIn("தமிழ் பேசு")).toBe("tam_Taml"); // … the name is
    const m = await matchCommand("please change to tamil", real);
    expect(m?.effect).toEqual({ type: "settings", agent: { language: "tam_Taml" } });
    expect(confirmText(m!)).toBe("Change the language to Tamil?");
  });

  it("start every configured journey", () => {
    expect(journeyCommands(kioskContent.journeys).map((c) => c.id)).toEqual(kioskContent.journeys.map((j) => `journey.${j.id}`));
  });
});

describe("about the kiosk (CMD-2)", () => {
  it("answers from the kiosk's own definitions", () => {
    expect(aboutKiosk("capabilities", { journeys: kioskContent.journeys, webSearch: true })).toContain("Check in for your visit");
    expect(aboutKiosk("languages", { journeys: [], webSearch: false })).toContain("Tamil");
    expect(aboutKiosk("modes", { journeys: [], webSearch: false })).not.toContain("web");
    expect(aboutKiosk("modes", { journeys: [], webSearch: true })).toContain("from the web");
  });
});

describe("profile by conversation (CMD-10)", () => {
  it("reads 'elaborate answers' into the answer-depth question, picking the option by meaning", async () => {
    // Controlled vectors: the clause matches the depth field, and the 'fuller' option clearly leads.
    const depth = profileFields().find((f) => f.id === "depth")!;
    const axis = (i: number) => Array.from({ length: 8 }, (_, k) => (k === i ? 1 : 0));
    const embed: Embed = async (texts) =>
      texts.map((t) => (t === "with elaborate answers" ? [0.8, 0.6, 0, 0, 0, 0, 0, 0] : t === [depth.label, depth.description].join(". ") ? axis(0) : t === "A fuller explanation with the details" ? axis(1) : axis(7)));
    const m = await matchFields([depth], "with elaborate answers", { embed, meaning: { minScore: 0.5, margin: 0.1 } });
    expect(m.fills).toEqual([{ field: "depth", label: depth.label, value: "detailed", via: "meaning", text: "with elaborate answers" }]);
    const { profile, changes } = profilePatch(profileSchema.parse({ nickname: "Ravi", personality: { depth: "brief" } }), m.fills);
    expect(profile.personality.depth).toBe("detailed");
    expect(changes).toEqual([{ label: "When you ask something, what suits you best?", from: "A short, direct answer", to: "A fuller explanation with the details" }]);
  });

  it("applies interests and plain fields, and reports only real changes", () => {
    const profile = profileSchema.parse({ nickname: "Ravi", interests: ["policies"], city: "Chennai" });
    const { profile: next, changes } = profilePatch(profile, [
      { field: "interest-documents", value: true },
      { field: "interest-policies", value: true }, // already
      { field: "city", value: "Madurai" },
      { field: "nickname", value: "Ravi" }, // same
    ]);
    expect(next.interests).toEqual(["policies", "documents"]);
    expect(next.city).toBe("Madurai");
    expect(changes.map((c) => c.label)).toEqual(["Interested in my own documents", "City"]);
    expect(profileSchema.safeParse(next).success).toBe(true);
  });
});
