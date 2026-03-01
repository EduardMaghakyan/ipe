import { describe, test, expect } from "bun:test";
import { renderPlan } from "../../packages/ui/src/utils/markedRenderer";

describe("renderPlan", () => {
  test("empty input returns empty units and default title", () => {
    const result = renderPlan("");
    expect(result.units).toHaveLength(0);
    expect(result.title).toBe("Plan Review");
    expect(result.codeBlockMap.size).toBe(0);
  });

  test("parses headings into units", () => {
    const result = renderPlan("# Title\n\n## Subtitle");
    const headings = result.units.filter((u) => u.type === "heading");
    expect(headings).toHaveLength(2);
    expect(headings[0].rawText).toBe("# Title");
    expect(headings[1].rawText).toBe("## Subtitle");
  });

  test("extracts title from first heading", () => {
    const result = renderPlan("# My Plan\n\nSome text");
    expect(result.title).toBe("My Plan");
  });

  test("parses paragraphs into units", () => {
    const result = renderPlan("Hello world");
    const paragraphs = result.units.filter((u) => u.type === "paragraph");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].rawText).toContain("Hello world");
  });

  test("parses code blocks with per-line units", () => {
    const md = "```typescript\nconst x = 1;\nconst y = 2;\n```";
    const result = renderPlan(md);
    const codeLines = result.units.filter((u) => u.type === "code-line");
    expect(codeLines).toHaveLength(2);
    expect(codeLines[0].rawText).toBe("const x = 1;");
    expect(codeLines[1].rawText).toBe("const y = 2;");
  });

  test("parses list items into units", () => {
    const result = renderPlan("- item 1\n- item 2\n- item 3");
    const items = result.units.filter((u) => u.type === "list-item");
    expect(items).toHaveLength(3);
    expect(items[0].rawText).toContain("item 1");
    expect(items[1].rawText).toContain("item 2");
    expect(items[2].rawText).toContain("item 3");
  });

  test("parses tables with per-row units", () => {
    const md = "| Col1 | Col2 |\n| ---- | ---- |\n| a    | b    |";
    const result = renderPlan(md);
    const rows = result.units.filter((u) => u.type === "table-row");
    expect(rows).toHaveLength(2); // header + 1 data row
  });

  test("parses blockquotes into units", () => {
    const result = renderPlan("> This is a quote\n> continued");
    const quotes = result.units.filter((u) => u.type === "blockquote");
    expect(quotes.length).toBeGreaterThanOrEqual(1);
  });

  test("unit IDs are sequential", () => {
    const result = renderPlan("# Heading\n\nParagraph");
    for (let i = 0; i < result.units.length; i++) {
      expect(result.units[i].id).toBe(`u-${i}`);
    }
  });

  test("renders HTML output", () => {
    const result = renderPlan("# Title\n\nSome **bold** text");
    expect(result.html).toContain("<h1");
    expect(result.html).toContain("Title");
    expect(result.html).toContain("<strong>bold</strong>");
  });

  test("injects data-unit-id attributes on annotatable elements", () => {
    const result = renderPlan("# Title\n\nParagraph\n\n- item");
    expect(result.html).toContain('data-unit-id="u-0"');
    expect(result.html).toContain('data-unit-type="heading"');
    expect(result.html).toContain('data-unit-type="paragraph"');
    expect(result.html).toContain('data-unit-type="list-item"');
  });

  test("detects file refs in inline code when snippetPaths provided", () => {
    const paths = new Set(["src/app.ts"]);
    const result = renderPlan("Check `src/app.ts` for details", paths);
    expect(result.html).toContain('data-file-path="src/app.ts"');
    expect(result.html).toContain("file-ref");
  });

  test("inline code without matching path has no file-ref class", () => {
    const result = renderPlan("Use `someVar` here");
    expect(result.html).toContain("inline-code");
    expect(result.html).not.toContain("file-ref");
  });

  test("diff detection in code blocks", () => {
    const md = "```diff\n+added\n-removed\n context\n```";
    const result = renderPlan(md);
    expect(result.html).toContain("diff-add");
    expect(result.html).toContain("diff-remove");
  });

  test("code block lines have correct source line numbers", () => {
    const md = "# Title\n\n```js\nconst x = 1;\nconst y = 2;\n```";
    const result = renderPlan(md);
    const codeLines = result.units.filter((u) => u.type === "code-line");
    expect(codeLines).toHaveLength(2);
    // Code starts at line 3 (fence), content at line 4-5
    expect(codeLines[0].sourceStartLine).toBe(4);
    expect(codeLines[1].sourceStartLine).toBe(5);
  });

  test("heading source line numbers are correct", () => {
    const result = renderPlan("# Title");
    expect(result.units[0].sourceStartLine).toBe(1);
    expect(result.units[0].sourceEndLine).toBe(1);
  });

  test("mixed content produces correct unit types", () => {
    const md = [
      "# Title",
      "",
      "Some text here",
      "",
      "```js",
      "code()",
      "```",
      "",
      "- list item",
      "",
      "> quote",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n");
    const result = renderPlan(md);
    const types = result.units.map((u) => u.type);
    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
    expect(types).toContain("code-line");
    expect(types).toContain("list-item");
    expect(types).toContain("blockquote");
    expect(types).toContain("table-row");
  });

  test("deterministic: same markdown produces same unit IDs", () => {
    const md = "# Title\n\n- item 1\n- item 2";
    const r1 = renderPlan(md);
    const r2 = renderPlan(md);
    expect(r1.units.map((u) => u.id)).toEqual(r2.units.map((u) => u.id));
  });

  test("links render with target=_blank", () => {
    const result = renderPlan("[Link](https://example.com)");
    expect(result.html).toContain('target="_blank"');
    expect(result.html).toContain("https://example.com");
  });

  test("unit-end markers are present in HTML output", () => {
    const result = renderPlan("# Title\n\nParagraph\n\n- item");
    expect(result.html).toContain("<!-- unit-end:u-0 -->");
    expect(result.html).toContain("<!-- unit-end:u-1 -->");
    expect(result.html).toContain("<!-- unit-end:u-2 -->");
  });

  test("code blocks have a single unit-end marker for last line", () => {
    const md = "```js\nline1\nline2\nline3\n```";
    const result = renderPlan(md);
    const codeLines = result.units.filter((u) => u.type === "code-line");
    const lastId = codeLines[codeLines.length - 1].id;
    // Only one unit-end marker for the whole code block, using last line's ID
    expect(result.html).toContain(`<!-- unit-end:${lastId} -->`);
    // No unit-end markers for non-last code lines
    for (let i = 0; i < codeLines.length - 1; i++) {
      expect(result.html).not.toContain(`<!-- unit-end:${codeLines[i].id} -->`);
    }
  });

  test("codeBlockMap maps all code-line IDs to last line ID", () => {
    const md = "```js\nline1\nline2\nline3\n```";
    const result = renderPlan(md);
    const codeLines = result.units.filter((u) => u.type === "code-line");
    expect(codeLines).toHaveLength(3);
    const lastId = codeLines[2].id;
    for (const cl of codeLines) {
      expect(result.codeBlockMap.get(cl.id)).toBe(lastId);
    }
  });

  test("codeBlockMap is empty when no code blocks exist", () => {
    const result = renderPlan("# Title\n\nParagraph");
    expect(result.codeBlockMap.size).toBe(0);
  });

  test("multiple code blocks have separate codeBlockMap entries", () => {
    const md = "```js\na\nb\n```\n\n```py\nc\nd\n```";
    const result = renderPlan(md);
    const codeLines = result.units.filter((u) => u.type === "code-line");
    expect(codeLines).toHaveLength(4);
    // First block: lines 0,1 -> last is 1
    expect(result.codeBlockMap.get(codeLines[0].id)).toBe(codeLines[1].id);
    expect(result.codeBlockMap.get(codeLines[1].id)).toBe(codeLines[1].id);
    // Second block: lines 2,3 -> last is 3
    expect(result.codeBlockMap.get(codeLines[2].id)).toBe(codeLines[3].id);
    expect(result.codeBlockMap.get(codeLines[3].id)).toBe(codeLines[3].id);
  });
});
