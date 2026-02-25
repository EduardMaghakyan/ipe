import type { Block, PlanLine } from "../types";
import { escapeHtml, isDiffContent } from "./diff";

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

export function renderInlineMarkdown(
  text: string,
  snippetPaths?: Set<string>,
): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, (_match, code: string) => {
      const pathPart = code.replace(/:.*$/, "");
      if (snippetPaths?.has(pathPart)) {
        return `<code class="inline-code file-ref" data-file-path="${escapeHtml(pathPart)}">${code}</code>`;
      }
      return `<code class="inline-code">${code}</code>`;
    })
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');
}

function getBlockPosition(
  idx: number,
  total: number,
): "only" | "first" | "middle" | "last" {
  if (total === 1) return "only";
  if (idx === 0) return "first";
  if (idx === total - 1) return "last";
  return "middle";
}

export function blocksToLines(
  blocks: Block[],
  snippetPaths?: Set<string>,
): PlanLine[] {
  const result: PlanLine[] = [];
  const allSourceLines = new Set<number>();

  // Collect all line numbers covered by blocks
  for (const block of blocks) {
    for (let l = block.startLine; l <= block.endLine; l++) {
      allSourceLines.add(l);
    }
  }

  // Find max line to know range for blank lines
  let maxLine = 0;
  for (const block of blocks) {
    if (block.endLine > maxLine) maxLine = block.endLine;
  }

  // Build a map of lineNumber -> block for quick lookup
  const lineToBlock = new Map<number, Block>();
  for (const block of blocks) {
    for (let l = block.startLine; l <= block.endLine; l++) {
      lineToBlock.set(l, block);
    }
  }

  // Iterate all source lines from 1 to maxLine
  for (let lineNum = 1; lineNum <= maxLine; lineNum++) {
    const block = lineToBlock.get(lineNum);
    if (!block) {
      // Blank line between blocks
      result.push({
        lineNumber: lineNum,
        blockId: "",
        blockType: "blank",
        html: "",
        raw: "",
        blockPosition: "only",
        isBlank: true,
      });
      continue;
    }

    const idxInBlock = lineNum - block.startLine;
    const blockLineCount = block.endLine - block.startLine + 1;
    const position = getBlockPosition(idxInBlock, blockLineCount);
    const sourceLines = block.content.split("\n");
    const rawLine = sourceLines[idxInBlock] ?? "";

    const html = renderLineHtml(
      block,
      rawLine,
      idxInBlock,
      sourceLines,
      snippetPaths,
    );

    const isFence =
      block.type === "code" &&
      (idxInBlock === 0 || idxInBlock === sourceLines.length - 1);

    result.push({
      lineNumber: lineNum,
      blockId: block.id,
      blockType: block.type,
      html,
      raw: rawLine,
      blockPosition: position,
      isFence,
    });
  }

  return result;
}

function renderLineHtml(
  block: Block,
  rawLine: string,
  idxInBlock: number,
  allLines: string[],
  snippetPaths?: Set<string>,
): string {
  switch (block.type) {
    case "heading": {
      const match = rawLine.match(/^(#{1,6})\s+(.*)/);
      if (!match) return escapeHtml(rawLine);
      const level = match[1].length;
      const text = renderInlineMarkdown(match[2], snippetPaths);
      return `<span class="heading-text h${level}">${text}</span>`;
    }

    case "paragraph":
      return `<span class="p-line">${renderInlineMarkdown(rawLine, snippetPaths)}</span>`;

    case "code": {
      // Fence lines
      if (idxInBlock === 0 || idxInBlock === allLines.length - 1) {
        return `<span class="code-fence">${escapeHtml(rawLine)}</span>`;
      }
      // Content lines
      const firstLine = allLines[0].trim();
      const lang = firstLine.replace(/^```/, "").trim();
      const contentLines = allLines.slice(1, -1);
      if (isDiffContent(lang, contentLines)) {
        const escaped = escapeHtml(rawLine);
        if (/^@@\s/.test(rawLine))
          return `<code class="code-line diff-hunk">${escaped}</code>`;
        if (rawLine.startsWith("+"))
          return `<code class="code-line diff-add">${escaped}</code>`;
        if (rawLine.startsWith("-"))
          return `<code class="code-line diff-remove">${escaped}</code>`;
        return `<code class="code-line diff-context">${escaped}</code>`;
      }
      return `<code class="code-line">${escapeHtml(rawLine)}</code>`;
    }

    case "list": {
      const text = rawLine
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "");
      const isOrdered = /^\s*\d+\.\s/.test(rawLine);
      const marker = isOrdered
        ? `<span class="list-marker">${block.listStart ?? "1"}.</span>`
        : `<span class="list-marker">•</span>`;
      return `<span class="list-item">${marker} ${renderInlineMarkdown(text, snippetPaths)}</span>`;
    }

    case "blockquote": {
      const text = rawLine.replace(/^>\s?/, "");
      return `<span class="bq-line">${renderInlineMarkdown(text, snippetPaths)}</span>`;
    }

    case "table": {
      const cells = rawLine
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c);
      // Separator row (e.g., | --- | --- |)
      if (/^[\s|:-]+$/.test(rawLine) && rawLine.includes("-")) {
        return `<span class="table-separator">${escapeHtml(rawLine)}</span>`;
      }
      // Header or data row
      const isHeader = idxInBlock === 0;
      const cellTag = isHeader ? "th" : "td";
      const cellsHtml = cells
        .map(
          (c) =>
            `<${cellTag}>${renderInlineMarkdown(c, snippetPaths)}</${cellTag}>`,
        )
        .join("");
      return `<table class="table-row-line"><tr>${cellsHtml}</tr></table>`;
    }

    default:
      return escapeHtml(rawLine);
  }
}
