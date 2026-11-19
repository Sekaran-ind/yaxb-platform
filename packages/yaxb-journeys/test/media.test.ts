// Photo fields (MED-4): what they may say, and that an answer is only references to photos.
import { describe, expect, it } from "vitest";
import { fieldListProblems, fieldProblem, isMediaRef, type Field } from "../src/index.js";

const ref = (n: number) => ({ hash: n.toString(16).padStart(64, "0"), type: "image/jpeg", size: 1000 + n });

describe("photo fields", () => {
  it("checks a photo field's options", () => {
    expect(fieldListProblems("", [{ id: "p", type: "photo", label: "Photo", max: 3, read: "ocr", keep: "box" }])).toEqual([]);
    const bad = fieldListProblems("", [
      { id: "a", type: "photo", label: "A", max: 9 },
      { id: "b", type: "photo", label: "B", read: "magic" },
      { id: "c", type: "text", label: "C", keep: "box" },
    ]).join("\n");
    expect(bad).toMatch(/max is for photos/);
    expect(bad).toMatch(/read is for photos/);
    expect(bad).toMatch(/keep is for photos/);
  });

  it("takes only photo references, up to max", () => {
    const f: Field = { id: "p", type: "photo", label: "A photo", required: true, max: 2 };
    expect(fieldProblem(f, [])).toMatch(/required/);
    expect(fieldProblem(f, [ref(1)])).toBeNull();
    expect(fieldProblem(f, [ref(1), ref(2), ref(3)])).toMatch(/at most 2 photos/);
    expect(fieldProblem(f, ["data:image/jpeg;base64,AAAA"])).toMatch(/photos taken here/);
    expect(fieldProblem(f, [{ hash: "nope", type: "image/jpeg", size: 1 }])).toMatch(/photos taken here/);
    expect(isMediaRef({ ...ref(1), text: "BLOCK B" })).toBe(true);
  });
});
