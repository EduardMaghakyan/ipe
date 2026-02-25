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

  test("ordered list items have correct listStart", () => {
    const blocks = parseMarkdown("1. first\n2. second\n3. third");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].listStart).toBe(1);
    expect(blocks[1].listStart).toBe(2);
    expect(blocks[2].listStart).toBe(3);
  });

  test("unordered list items have listStart", () => {
    const blocks = parseMarkdown("- a\n- b\n- c");
    expect(blocks).toHaveLength(3);
    expect(blocks[0].listStart).toBe(1);
    expect(blocks[1].listStart).toBe(2);
    expect(blocks[2].listStart).toBe(3);
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

  // Line number tests
  test("heading has correct startLine and endLine", () => {
    const blocks = parseMarkdown("# Title");
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(1);
  });

  test("blocks have correct line numbers with blank lines between", () => {
    const blocks = parseMarkdown("# Heading\n\nParagraph\n\n> Quote");
    // Line 1: # Heading
    // Line 2: (blank)
    // Line 3: Paragraph
    // Line 4: (blank)
    // Line 5: > Quote
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(1);
    expect(blocks[1].startLine).toBe(3);
    expect(blocks[1].endLine).toBe(3);
    expect(blocks[2].startLine).toBe(5);
    expect(blocks[2].endLine).toBe(5);
  });

  test("code block line numbers span fence and content", () => {
    const md = "```js\nconst x = 1;\nconst y = 2;\n```";
    const blocks = parseMarkdown(md);
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(4);
  });

  test("multi-line paragraph has correct line range", () => {
    const blocks = parseMarkdown("First line\nSecond line\nThird line");
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(3);
  });

  test("list items have sequential line numbers", () => {
    const blocks = parseMarkdown("- item 1\n- item 2\n- item 3");
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(1);
    expect(blocks[1].startLine).toBe(2);
    expect(blocks[1].endLine).toBe(2);
    expect(blocks[2].startLine).toBe(3);
    expect(blocks[2].endLine).toBe(3);
  });

  test("table line numbers span all rows", () => {
    const md = "| A | B |\n| - | - |\n| 1 | 2 |";
    const blocks = parseMarkdown(md);
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(3);
  });

  test("blockquote line numbers span all lines", () => {
    const blocks = parseMarkdown("> line 1\n> line 2");
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(2);
  });

  test("mixed content has correct line numbers throughout", () => {
    const md = [
      "# Title", // line 1
      "", // line 2
      "Some text", // line 3
      "", // line 4
      "```js", // line 5
      "code()", // line 6
      "```", // line 7
      "", // line 8
      "- item", // line 9
    ].join("\n");
    const blocks = parseMarkdown(md);
    expect(blocks[0].startLine).toBe(1); // heading
    expect(blocks[0].endLine).toBe(1);
    expect(blocks[1].startLine).toBe(3); // paragraph
    expect(blocks[1].endLine).toBe(3);
    expect(blocks[2].startLine).toBe(5); // code
    expect(blocks[2].endLine).toBe(7);
    expect(blocks[3].startLine).toBe(9); // list
    expect(blocks[3].endLine).toBe(9);
  });
});
