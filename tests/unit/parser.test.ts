import { describe, test, expect } from "bun:test";
import { parseMarkdown } from "../../packages/ui/src/utils/parser";

describe("parseMarkdown", () => {
  test("empty input returns empty array", () => {
    expect(parseMarkdown("")).toEqual([]);
  });

  test("parses headings", () => {
    const blocks = parseMarkdown("# Title\n\n## Subtitle");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].content).toBe("# Title");
    expect(blocks[1].type).toBe("heading");
    expect(blocks[1].content).toBe("## Subtitle");
  });

  test("parses paragraphs", () => {
    const blocks = parseMarkdown("Hello world\nSecond line");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].content).toBe("Hello world\nSecond line");
  });

  test("parses fenced code blocks", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("code");
    expect(blocks[0].content).toContain("const x = 1;");
  });

  test("parses unordered lists as per-item blocks", () => {
    const blocks = parseMarkdown("- item 1\n- item 2\n- item 3");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("list");
    expect(blocks[0].content).toBe("- item 1");
    expect(blocks[1].content).toBe("- item 2");
    expect(blocks[2].content).toBe("- item 3");
  });

  test("parses ordered lists as per-item blocks", () => {
    const blocks = parseMarkdown("1. first\n2. second\n3. third");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("list");
    expect(blocks[0].content).toBe("1. first");
    expect(blocks[1].content).toBe("2. second");
    expect(blocks[2].content).toBe("3. third");
  });

  test("parses tables", () => {
    const md = "| Col1 | Col2 |\n| ---- | ---- |\n| a    | b    |";
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("table");
  });

  test("parses blockquotes", () => {
    const blocks = parseMarkdown("> This is a quote\n> continued");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("blockquote");
  });

  test("block IDs are sequential", () => {
    const blocks = parseMarkdown("# Heading\n\nParagraph\n\n> Quote");
    expect(blocks[0].id).toBe("block-0");
    expect(blocks[1].id).toBe("block-1");
    expect(blocks[2].id).toBe("block-2");
  });

  test("parses mixed content", () => {
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
    const blocks = parseMarkdown(md);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "code",
      "list",
      "blockquote",
      "table",
    ]);
  });
});
