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
      const startLine = i + 1; // 1-based
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
        startLine,
        endLine: i, // i is now past the closing fence
      });
      continue;
    }

    // Heading
    if (/^#{1,6}\s/.test(line)) {
      const lineNum = i + 1;
      blocks.push({
        id: `block-${blockIndex++}`,
        type: "heading",
        content: line,
        raw: line,
        startLine: lineNum,
        endLine: lineNum,
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const startLine = i + 1;
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
        startLine,
        endLine: i, // i is now past the last quote line
      });
      continue;
    }

    // List (unordered or ordered) — one block per item, with position tracking
    if (/^(\s*[-*+]|\s*\d+\.)\s/.test(line)) {
      let itemLines = [line];
      let itemStartLine = i + 1;
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
            startLine: itemStartLine,
            endLine: i, // exclusive of next item
          });
          listPosition++;
          itemLines = [lines[i]];
          itemStartLine = i + 1;
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
        startLine: itemStartLine,
        endLine: itemStartLine + itemLines.length - 1,
      });
      continue;
    }

    // Table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /\|[\s-:]+\|/.test(lines[i + 1])
    ) {
      const startLine = i + 1;
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
        startLine,
        endLine: startLine + tableLines.length - 1,
      });
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    const startLine = i + 1;
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
      startLine,
      endLine: startLine + paraLines.length - 1,
    });
  }

  return blocks;
}
