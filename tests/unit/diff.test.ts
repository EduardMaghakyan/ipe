import { describe, test, expect } from "bun:test";
import {
  isDiffContent,
  computeDiff,
  collapseDiffContext,
} from "../../packages/ui/src/utils/diff";
import type { DiffLine } from "../../packages/ui/src/utils/diff";

describe("isDiffContent", () => {
  test("returns true for diff language tag", () => {
    expect(isDiffContent("diff", [])).toBe(true);
  });

  test("returns true when lines contain + and - prefixes", () => {
    const lines = ["+added line", "-removed line", " context"];
    expect(isDiffContent("", lines)).toBe(true);
  });

  test("returns false for regular code", () => {
    const lines = ["const x = 1;", "console.log(x);"];
    expect(isDiffContent("", lines)).toBe(false);
  });

  test("returns false with only one diff-like line", () => {
    const lines = ["+only one", "regular line"];
    expect(isDiffContent("", lines)).toBe(false);
  });

  test("handles bare + and - lines", () => {
    const lines = ["+", "-", "context"];
    expect(isDiffContent("", lines)).toBe(true);
  });

  test("ignores ++ and -- prefixes", () => {
    const lines = ["++not-diff", "--not-diff"];
    expect(isDiffContent("", lines)).toBe(false);
  });
});

describe("computeDiff", () => {
  test("identical texts produce all context lines", () => {
    const result = computeDiff("a\nb\nc", "a\nb\nc");
    expect(result).toEqual([
      { type: "context", content: "a" },
      { type: "context", content: "b" },
      { type: "context", content: "c" },
    ]);
  });

  test("additions only", () => {
    const result = computeDiff("a\nc", "a\nb\nc");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "context", content: "a" });
    expect(result[1]).toEqual({ type: "add", content: "b" });
    expect(result[2]).toEqual({ type: "context", content: "c" });
  });

  test("removals only", () => {
    const result = computeDiff("a\nb\nc", "a\nc");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "context", content: "a" });
    expect(result[1]).toEqual({ type: "remove", content: "b" });
    expect(result[2]).toEqual({ type: "context", content: "c" });
  });

  test("mixed additions and removals", () => {
    const result = computeDiff("a\nb\nc", "a\nx\nc");
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: "context", content: "a" });
    expect(result.find((l) => l.type === "remove")?.content).toBe("b");
    expect(result.find((l) => l.type === "add")?.content).toBe("x");
    expect(result[3]).toEqual({ type: "context", content: "c" });
  });

  test("empty old text produces additions (plus empty-string context from split)", () => {
    const result = computeDiff("", "a\nb");
    // "" splits into [""], so we get a context line for "" plus 2 additions
    const adds = result.filter((l) => l.type === "add");
    expect(adds).toHaveLength(2);
    expect(adds[0].content).toBe("a");
    expect(adds[1].content).toBe("b");
  });

  test("empty new text produces removals (plus empty-string context from split)", () => {
    const result = computeDiff("a\nb", "");
    // "" splits into [""], so we get 2 removals plus a context line for ""
    const removes = result.filter((l) => l.type === "remove");
    expect(removes).toHaveLength(2);
    expect(removes[0].content).toBe("a");
    expect(removes[1].content).toBe("b");
  });

  test("both empty produces single context line", () => {
    const result = computeDiff("", "");
    expect(result).toEqual([{ type: "context", content: "" }]);
  });

  test("multiline plan diff", () => {
    const old = "# Plan\n\n## Step 1\nDo A\n\n## Step 2\nDo B";
    const current =
      "# Plan\n\n## Step 1\nDo A revised\n\n## Step 2\nDo B\n\n## Step 3\nDo C";
    const result = computeDiff(old, current);

    const adds = result.filter((l) => l.type === "add");
    const removes = result.filter((l) => l.type === "remove");
    expect(adds.length).toBeGreaterThan(0);
    expect(removes.length).toBeGreaterThan(0);
    expect(adds.some((l) => l.content.includes("Step 3"))).toBe(true);
  });
});

describe("collapseDiffContext", () => {
  function ctx(content: string): DiffLine {
    return { type: "context", content };
  }
  function add(content: string): DiffLine {
    return { type: "add", content };
  }
  function rem(content: string): DiffLine {
    return { type: "remove", content };
  }

  test("all context lines returns a single fold", () => {
    const lines: DiffLine[] = Array.from({ length: 30 }, (_, i) =>
      ctx(`line ${i}`),
    );
    const result = collapseDiffContext(lines);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("fold");
    if (result[0].type === "fold") {
      expect(result[0].count).toBe(30);
    }
  });

  test("all changed lines returns all lines, no folds", () => {
    const lines: DiffLine[] = [add("a"), rem("b"), add("c")];
    const result = collapseDiffContext(lines);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.type !== "fold")).toBe(true);
  });

  test("change in the middle keeps ±10 context and folds the rest", () => {
    // 25 context + 1 add + 25 context = 51 lines
    const lines: DiffLine[] = [
      ...Array.from({ length: 25 }, (_, i) => ctx(`before ${i}`)),
      add("changed"),
      ...Array.from({ length: 25 }, (_, i) => ctx(`after ${i}`)),
    ];
    const result = collapseDiffContext(lines);
    // Should have: fold(15) + 10 ctx + 1 add + 10 ctx + fold(15)
    const folds = result.filter((r) => r.type === "fold");
    expect(folds).toHaveLength(2);
    if (folds[0].type === "fold") expect(folds[0].count).toBe(15);
    if (folds[1].type === "fold") expect(folds[1].count).toBe(15);
    // Total kept lines = 10 + 1 + 10 = 21
    const kept = result.filter((r) => r.type !== "fold");
    expect(kept).toHaveLength(21);
  });

  test("change at start clips context window to boundary", () => {
    const lines: DiffLine[] = [
      add("first"),
      ...Array.from({ length: 25 }, (_, i) => ctx(`after ${i}`)),
    ];
    const result = collapseDiffContext(lines);
    // 1 add + 10 ctx kept + fold(15)
    const folds = result.filter((r) => r.type === "fold");
    expect(folds).toHaveLength(1);
    if (folds[0].type === "fold") expect(folds[0].count).toBe(15);
  });

  test("custom context size", () => {
    const lines: DiffLine[] = [
      ...Array.from({ length: 10 }, (_, i) => ctx(`before ${i}`)),
      add("changed"),
      ...Array.from({ length: 10 }, (_, i) => ctx(`after ${i}`)),
    ];
    const result = collapseDiffContext(lines, 2);
    // fold(8) + 2 ctx + 1 add + 2 ctx + fold(8)
    const folds = result.filter((r) => r.type === "fold");
    expect(folds).toHaveLength(2);
    if (folds[0].type === "fold") expect(folds[0].count).toBe(8);
    if (folds[1].type === "fold") expect(folds[1].count).toBe(8);
    const kept = result.filter((r) => r.type !== "fold");
    expect(kept).toHaveLength(5);
  });

  test("adjacent changes within context window produce no fold between them", () => {
    const lines: DiffLine[] = [
      add("first change"),
      ...Array.from({ length: 5 }, (_, i) => ctx(`between ${i}`)),
      add("second change"),
    ];
    const result = collapseDiffContext(lines);
    // All lines are within ±10 of a change, no folds
    expect(result.every((r) => r.type !== "fold")).toBe(true);
    expect(result).toHaveLength(7);
  });

  test("empty input returns empty", () => {
    expect(collapseDiffContext([])).toEqual([]);
  });
});
