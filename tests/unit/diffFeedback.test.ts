import { describe, test, expect } from "bun:test";
import { formatDiffFeedback } from "../../packages/ui/src/utils/diffFeedback";
import type { DiffAnnotation } from "../../packages/ui/src/types";

describe("formatDiffFeedback", () => {
  test("returns empty string for no annotations and no comment", () => {
    expect(formatDiffFeedback([])).toBe("");
    expect(formatDiffFeedback([], "")).toBe("");
    expect(formatDiffFeedback([], "   ")).toBe("");
  });

  test("formats general comment only", () => {
    const result = formatDiffFeedback([], "Great work overall");
    expect(result).toContain("General feedback:");
    expect(result).toContain("> Great work overall");
    expect(result).toContain("---");
  });

  test("formats annotations grouped by file", () => {
    const annotations: DiffAnnotation[] = [
      {
        id: "1",
        filePath: "src/auth.ts",
        lineKey: "h0-l3",
        startLineKey: "h0-l3",
        endLineKey: "h0-l3",
        selectedText: "throw new Error('bad')",
        comment: "Use a custom error class",
      },
      {
        id: "2",
        filePath: "src/auth.ts",
        lineKey: "h0-l5",
        startLineKey: "h0-l5",
        endLineKey: "h0-l6",
        selectedText: "validate(password)",
        comment: "Add rate limiting",
      },
      {
        id: "3",
        filePath: "src/utils.ts",
        lineKey: "h0-l1",
        startLineKey: "h0-l1",
        endLineKey: "h0-l1",
        selectedText: "const x = 1",
        comment: "Use const instead of let",
      },
    ];

    const result = formatDiffFeedback(annotations, "Needs some fixes");
    expect(result).toContain("General feedback:");
    expect(result).toContain("> Needs some fixes");
    expect(result).toContain("File: src/auth.ts");
    expect(result).toContain("File: src/utils.ts");
    expect(result).toContain("## 1. \"throw new Error('bad')\"");
    expect(result).toContain("> Use a custom error class");
    expect(result).toContain('## 2. "validate(password)"');
    expect(result).toContain('## 3. "const x = 1"');
    expect(result).toContain("---");
  });
});
