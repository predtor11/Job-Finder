import { describe, it, expect } from "vitest";
import { extractJson } from "@/lib/ai/gemini";

describe("extractJson (tolerant model-output parsing)", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(extractJson('Here you go:\n```json\n{"a": [1, 2]}\n```')).toEqual({
      a: [1, 2],
    });
  });

  it("parses JSON with leading prose", () => {
    expect(extractJson('Sure! {"ok": true} — done.')).toEqual({ ok: true });
  });

  it("parses arrays", () => {
    expect(extractJson("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("throws on garbage", () => {
    expect(() => extractJson("no json here at all")).toThrow();
  });
});
