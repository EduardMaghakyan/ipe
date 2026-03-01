import { Marked, Renderer } from "marked";
import type { Tokens } from "marked";
import type { AnnotatableUnit } from "../types";
import { escapeHtml, isDiffContent } from "./diff";

export interface RenderResult {
  html: string;
  units: AnnotatableUnit[];
  title: string;
  /** Maps every code-line unit ID → the last code-line unit ID in its block */
  codeBlockMap: Map<string, string>;
}

function buildLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLine(offsets: number[], charIdx: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= charIdx) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

export function renderPlan(
  markdown: string,
  snippetPaths?: Set<string>,
): RenderResult {
  const units: AnnotatableUnit[] = [];
  const codeBlockMap = new Map<string, string>();
  let unitCounter = 0;
  let title = "Plan Review";
  let titleFound = false;

  const lineOffsets = buildLineOffsets(markdown);
  // Cursor-based search to handle repeated text
  let searchFrom = 0;

  function nextUnitId(): string {
    return `u-${unitCounter++}`;
  }

  function findSourceLine(raw: string): number {
    const needle = raw.trimEnd();
    const idx = markdown.indexOf(needle, searchFrom);
    if (idx === -1) {
      // Fallback: search from beginning
      const fallback = markdown.indexOf(needle);
      if (fallback === -1) return 1;
      return offsetToLine(lineOffsets, fallback);
    }
    searchFrom = idx + needle.length;
    return offsetToLine(lineOffsets, idx);
  }

  const renderer = new Renderer();

  renderer.heading = function ({ tokens, depth, raw }: Tokens.Heading): string {
    const id = nextUnitId();
    const startLine = findSourceLine(raw);
    const text = this.parser.parseInline(tokens);
    if (!titleFound) {
      // Extract plain text for title (strip HTML tags)
      title = text.replace(/<[^>]*>/g, "");
      titleFound = true;
    }
    units.push({
      id,
      type: "heading",
      rawText: raw.trim(),
      sourceStartLine: startLine,
      sourceEndLine: startLine,
    });
    return `<h${depth} data-unit-id="${id}" data-unit-type="heading">${text}</h${depth}><!-- unit-end:${id} -->\n`;
  };

  renderer.paragraph = function ({ tokens, raw }: Tokens.Paragraph): string {
    const id = nextUnitId();
    const startLine = findSourceLine(raw);
    const lineCount = raw.trim().split("\n").length;
    const text = this.parser.parseInline(tokens);
    units.push({
      id,
      type: "paragraph",
      rawText: raw.trim(),
      sourceStartLine: startLine,
      sourceEndLine: startLine + lineCount - 1,
    });
    return `<p data-unit-id="${id}" data-unit-type="paragraph">${text}</p><!-- unit-end:${id} -->\n`;
  };

  renderer.listitem = function (item: Tokens.ListItem): string {
    const id = nextUnitId();
    const startLine = findSourceLine(item.raw);
    const lineCount = item.raw.trim().split("\n").length;
    const text = this.parser.parse(item.tokens);
    units.push({
      id,
      type: "list-item",
      rawText: item.raw.trim(),
      sourceStartLine: startLine,
      sourceEndLine: startLine + lineCount - 1,
    });
    return `<li data-unit-id="${id}" data-unit-type="list-item">${text}</li><!-- unit-end:${id} -->\n`;
  };

  renderer.code = function ({ text, lang, raw }: Tokens.Code): string {
    const startLine = findSourceLine(raw);
    const codeLines = text.split("\n");
    const isDiff = isDiffContent(lang || "", codeLines);

    const blockLineIds: string[] = [];
    let inner = "";
    for (let i = 0; i < codeLines.length; i++) {
      const id = nextUnitId();
      blockLineIds.push(id);
      const line = codeLines[i];
      units.push({
        id,
        type: "code-line",
        rawText: line,
        sourceStartLine: startLine + 1 + i, // +1 for fence line
        sourceEndLine: startLine + 1 + i,
      });
      let cls = "code-line";
      if (isDiff) {
        if (/^@@\s/.test(line)) cls += " diff-hunk";
        else if (line.startsWith("+")) cls += " diff-add";
        else if (line.startsWith("-")) cls += " diff-remove";
        else cls += " diff-context";
      }
      inner += `<span data-unit-id="${id}" data-unit-type="code-line" class="${cls}">${escapeHtml(line)}\n</span>`;
    }

    // Map all code-line IDs in this block to the last one
    const lastId = blockLineIds[blockLineIds.length - 1];
    for (const lineId of blockLineIds) {
      codeBlockMap.set(lineId, lastId);
    }

    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    return `<div class="code-block"><pre><code${langAttr}>${inner}</code></pre></div><!-- unit-end:${lastId} -->\n`;
  };

  renderer.table = function (token: Tokens.Table): string {
    const startLine = findSourceLine(token.raw);

    // Header row
    const headerId = nextUnitId();
    units.push({
      id: headerId,
      type: "table-row",
      rawText: token.header.map((c) => c.text).join(" | "),
      sourceStartLine: startLine,
      sourceEndLine: startLine,
    });
    let headerCells = "";
    for (const cell of token.header) {
      const align = cell.align ? ` style="text-align:${cell.align}"` : "";
      headerCells += `<th${align}>${this.parser.parseInline(cell.tokens)}</th>`;
    }

    // Body rows (startLine + 2 skips header + separator)
    let bodyRows = "";
    for (let i = 0; i < token.rows.length; i++) {
      const rowId = nextUnitId();
      const row = token.rows[i];
      units.push({
        id: rowId,
        type: "table-row",
        rawText: row.map((c) => c.text).join(" | "),
        sourceStartLine: startLine + 2 + i,
        sourceEndLine: startLine + 2 + i,
      });
      let cells = "";
      for (const cell of row) {
        const align = cell.align ? ` style="text-align:${cell.align}"` : "";
        cells += `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
      }
      bodyRows += `<tr data-unit-id="${rowId}" data-unit-type="table-row">${cells}</tr><!-- unit-end:${rowId} -->\n`;
    }

    return `<table class="plan-table">
<thead><tr data-unit-id="${headerId}" data-unit-type="table-row">${headerCells}</tr><!-- unit-end:${headerId} --></thead>
<tbody>${bodyRows}</tbody>
</table>\n`;
  };

  renderer.blockquote = function ({ tokens, raw }: Tokens.Blockquote): string {
    const id = nextUnitId();
    const startLine = findSourceLine(raw);
    const lineCount = raw.trim().split("\n").length;
    const body = this.parser.parse(tokens);
    units.push({
      id,
      type: "blockquote",
      rawText: raw.trim(),
      sourceStartLine: startLine,
      sourceEndLine: startLine + lineCount - 1,
    });
    return `<blockquote data-unit-id="${id}" data-unit-type="blockquote">${body}</blockquote><!-- unit-end:${id} -->\n`;
  };

  renderer.codespan = function ({ text }: Tokens.Codespan): string {
    const pathPart = text.replace(/:.*$/, "");
    if (snippetPaths?.has(pathPart)) {
      return `<code class="inline-code file-ref" data-file-path="${escapeHtml(pathPart)}">${escapeHtml(text)}</code>`;
    }
    return `<code class="inline-code">${escapeHtml(text)}</code>`;
  };

  renderer.link = function ({ href, title, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(href)}" target="_blank"${titleAttr}>${text}</a>`;
  };

  const marked = new Marked({ renderer });
  const html = marked.parse(markdown) as string;

  return { html, units, title, codeBlockMap };
}
