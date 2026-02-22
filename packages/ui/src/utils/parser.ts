import type { Block } from "../types";

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  let blockIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const codeLines = [line];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        codeLines.push(lines[i]);
        i++;
      }
      const raw = codeLines.join("\n");
      blocks.push({
        id: `block-${blockIndex++}`,
        type: "code",
        content: raw,
        raw,
      });
      continue;
    }

    // Heading
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({
        id: `block-${blockIndex++}`,
        type: "heading",
        content: line,
        raw: line,
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteLines = [line];
      i++;
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i]);
        i++;
      }
      const raw = quoteLines.join("\n");
      blocks.push({
        id: `block-${blockIndex++}`,
        type: "blockquote",
        content: raw,
        raw,
      });
      continue;
    }

    // List (unordered or ordered) — one block per item, with position tracking
    if (/^(\s*[-*+]|\s*\d+\.)\s/.test(line)) {
      let itemLines = [line];
      let listPosition = 1;
      i++;
      while (i < lines.length) {
        if (/^(\s*[-*+]|\s*\d+\.)\s/.test(lines[i])) {
          // New list item — flush current item
          const raw = itemLines.join("\n");
          blocks.push({
            id: `block-${blockIndex++}`,
            type: "list",
            content: raw,
            raw,
            listStart: listPosition,
          });
          listPosition++;
          itemLines = [lines[i]];
          i++;
        } else if (lines[i].startsWith("  ") && lines[i].trim() !== "") {
          // Continuation line — append to current item
          itemLines.push(lines[i]);
          i++;
        } else {
          break;
        }
      }
      // Flush last item
      const raw = itemLines.join("\n");
      blocks.push({
        id: `block-${blockIndex++}`,
        type: "list",
        content: raw,
        raw,
        listStart: listPosition,
      });
      continue;
    }

    // Table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /\|[\s-:]+\|/.test(lines[i + 1])
    ) {
      const tableLines = [line];
      i++;
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const raw = tableLines.join("\n");
      blocks.push({
        id: `block-${blockIndex++}`,
        type: "table",
        content: raw,
        raw,
      });
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !lines[i].trimStart().startsWith("```") &&
      !lines[i].startsWith(">") &&
      !/^(\s*[-*+]|\s*\d+\.)\s/.test(lines[i]) &&
      !(
        lines[i].includes("|") &&
        i + 1 < lines.length &&
        /\|[\s-:]+\|/.test(lines[i + 1])
      )
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    const raw = paraLines.join("\n");
    blocks.push({
      id: `block-${blockIndex++}`,
      type: "paragraph",
      content: raw,
      raw,
    });
  }

  return blocks;
}
