import { describe, test, expect } from "bun:test";
import { formatFeedback } from "../../packages/ui/src/utils/feedback";
import type { UnitAnnotation } from "../../packages/ui/src/types";

function makeAnnotation(
  overrides: Partial<UnitAnnotation> & { id: string },
): UnitAnnotation {
  return {
    startUnitId: "u-0",
    endUnitId: "u-0",
    selectedText: "",
    comment: "",
    ...overrides,
  };
}

describe("formatFeedback", () => {
  test("no annotations and no general comment returns empty string", () => {
    expect(formatFeedback([], "")).toBe("");
    expect(formatFeedback([])).toBe("");
    expect(formatFeedback([], undefined)).toBe("");
  });

  test("general comment only", () => {
    const result = formatFeedback([], "Great plan!");
    expect(result).toContain("General feedback:");
    expect(result).toContain("> Great plan!");
  });

  test("annotations with selectedText", () => {
    const annotations: UnitAnnotation[] = [
      makeAnnotation({
        id: "1",
        selectedText: "some code",
        comment: "Fix this",
      }),
    ];
    const result = formatFeedback(annotations);
    expect(result).toContain('Feedback on: "some code"');
    expect(result).toContain("> Fix this");
  });

  test("selectedText is truncated at 100 chars", () => {
    const longText = "a".repeat(150);
    const annotations: UnitAnnotation[] = [
      makeAnnotation({
        id: "1",
        selectedText: longText,
        comment: "Too long",
      }),
    ];
    const result = formatFeedback(annotations);
    expect(result).toContain("a".repeat(100) + "...");
    expect(result).not.toContain("a".repeat(101));
  });

  test("annotation without selectedText shows generic feedback header", () => {
    const annotations: UnitAnnotation[] = [
      makeAnnotation({
        id: "1",
        selectedText: "",
        comment: "General note",
      }),
    ];
    const result = formatFeedback(annotations);
    expect(result).toContain('Feedback on: ""');
    expect(result).toContain("> General note");
  });

  test("general comment is prepended before annotations", () => {
    const annotations: UnitAnnotation[] = [
      makeAnnotation({ id: "1", selectedText: "x", comment: "note" }),
    ];
    const result = formatFeedback(annotations, "Overall looks good");
    const generalIdx = result.indexOf("General feedback:");
    const annotationIdx = result.indexOf("Plan feedback:");
    expect(generalIdx).toBeLessThan(annotationIdx);
  });

  test("multiple annotations are numbered", () => {
    const annotations: UnitAnnotation[] = [
      makeAnnotation({ id: "1", selectedText: "a", comment: "first" }),
      makeAnnotation({ id: "2", selectedText: "b", comment: "second" }),
    ];
    const result = formatFeedback(annotations);
    expect(result).toContain("## 1.");
    expect(result).toContain("## 2.");
  });

  test("result ends with separator", () => {
    const result = formatFeedback([], "Some feedback");
    expect(result).toMatch(/---$/);
  });
});
