<script lang="ts">
  import type { LineAnnotation, Block, FileSnippet } from "../types";
  import { isDiffContent, escapeHtml } from "../utils/diff";
  import InlineComment from "./InlineComment.svelte";
  import FileSnippetPanel from "./FileSnippetPanel.svelte";

  interface Props {
    blocks: Block[];
    annotations: LineAnnotation[];
    fileSnippets?: FileSnippet[];
    theme: "dark" | "light";
    onAddAnnotation: (a: LineAnnotation) => void;
    onRemoveAnnotation: (id: string) => void;
    onUpdateAnnotation: (id: string, comment: string) => void;
  }

  let {
    blocks,
    annotations,
    fileSnippets = [],
    theme,
    onAddAnnotation,
    onRemoveAnnotation,
    onUpdateAnnotation,
  }: Props = $props();

  let editingId = $state<string | null>(null);
  let activeSnippet = $state<FileSnippet | null>(null);
  let hoveredLine = $state<number | null>(null);
  let selectionAnchor = $state<number | null>(null);

  // Build a lookup map from file paths to snippets
  let snippetMap = $derived.by(() => {
    const map = new Map<string, FileSnippet>();
    for (const s of fileSnippets) {
      map.set(s.path, s);
    }
    return map;
  });

  // Set of all highlighted line numbers (from annotations)
  let highlightedLines = $derived.by(() => {
    const set = new Set<number>();
    for (const ann of annotations) {
      for (let l = ann.startLine; l <= ann.endLine; l++) {
        set.add(l);
      }
    }
    return set;
  });

  function handleFileRefClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const ref = target.closest("[data-file-path]") as HTMLElement | null;
    if (!ref) return;
    const path = ref.dataset.filePath;
    if (!path) return;
    const snippet = snippetMap.get(path);
    if (!snippet || !snippet.content) return;

    activeSnippet = snippet;
    e.stopPropagation();
  }

  function handleDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (
      !target.closest(".file-snippet-panel") &&
      !target.closest("[data-file-path]")
    ) {
      activeSnippet = null;
    }
  }

  function handlePlusClick(e: MouseEvent, lineNum: number) {
    if (e.shiftKey && selectionAnchor !== null) {
      // Range selection
      const start = Math.min(selectionAnchor, lineNum);
      const end = Math.max(selectionAnchor, lineNum);
      const rawLines = getRawLinesInRange(start, end);
      const id = `ann-${Date.now()}`;
      onAddAnnotation({
        id,
        startLine: start,
        endLine: end,
        selectedText: rawLines,
        comment: "",
      });
      editingId = id;
      selectionAnchor = null;
    } else {
      // Single line
      const rawLines = getRawLinesInRange(lineNum, lineNum);
      const id = `ann-${Date.now()}`;
      onAddAnnotation({
        id,
        startLine: lineNum,
        endLine: lineNum,
        selectedText: rawLines,
        comment: "",
      });
      editingId = id;
      selectionAnchor = lineNum;
    }
  }

  function getRawLinesInRange(start: number, end: number): string {
    const result: string[] = [];
    for (const block of blocks) {
      if (block.endLine < start || block.startLine > end) continue;
      const blockLines = block.raw.split("\n");
      for (let i = 0; i < blockLines.length; i++) {
        const lineNum = block.startLine + i;
        if (lineNum >= start && lineNum <= end) {
          result.push(blockLines[i]);
        }
      }
    }
    return result.join("\n");
  }

  function handleSave(id: string, comment: string) {
    onUpdateAnnotation(id, comment);
    editingId = null;
  }

  function handleCancel(id: string) {
    const ann = annotations.find((a) => a.id === id);
    if (ann && !ann.comment) {
      onRemoveAnnotation(id);
    }
    editingId = null;
  }

  function getAnnotationsEndingAtBlock(block: Block): LineAnnotation[] {
    return annotations.filter(
      (a) => a.endLine >= block.startLine && a.endLine <= block.endLine,
    );
  }

  function isLineHighlighted(lineNum: number): boolean {
    return highlightedLines.has(lineNum);
  }

  function getLineCount(block: Block): number {
    return block.endLine - block.startLine + 1;
  }

  // --- Rendering functions ---

  function renderInlineMarkdown(text: string): string {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, (_match, code: string) => {
        const pathPart = code.replace(/:.*$/, "");
        if (snippetMap.has(pathPart)) {
          return `<code class="inline-code file-ref" data-file-path="${escapeHtml(pathPart)}">${code}</code>`;
        }
        return `<code class="inline-code">${code}</code>`;
      })
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');
  }

  function renderHeading(block: Block): string {
    const match = block.content.match(/^(#{1,6})\s+(.*)/);
    if (!match) return block.content;
    const level = match[1].length;
    const text = renderInlineMarkdown(match[2]);
    return `<h${level}>${text}</h${level}>`;
  }

  function renderCode(block: Block): string {
    const lines = block.content.split("\n");
    const firstLine = lines[0].trim();
    const lang = firstLine.replace(/^```/, "").trim();
    const codeLines = lines.slice(1, -1);

    if (isDiffContent(lang, codeLines)) {
      const rendered = codeLines
        .map((line) => {
          const escaped = escapeHtml(line);
          if (/^@@\s/.test(line)) {
            return `<span class="diff-hunk">${escaped}</span>`;
          }
          if (line.startsWith("+")) {
            return `<span class="diff-add">${escaped}</span>`;
          }
          if (line.startsWith("-")) {
            return `<span class="diff-remove">${escaped}</span>`;
          }
          return `<span class="diff-context">${escaped}</span>`;
        })
        .join("\n");
      return `<pre class="diff-block"><code>${rendered}</code></pre>`;
    }

    const code = codeLines.join("\n");
    return `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(code)}</code></pre>`;
  }

  function renderList(block: Block): string {
    const lines = block.content.split("\n");
    const isOrdered = /^\s*\d+\.\s/.test(lines[0]);
    const items = lines.map((l) => {
      const text = l.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+\.\s+/, "");
      return `<li>${renderInlineMarkdown(text)}</li>`;
    });
    const tag = isOrdered ? "ol" : "ul";
    const startAttr =
      isOrdered && block.listStart ? ` start="${block.listStart}"` : "";
    return `<${tag}${startAttr}>${items.join("")}</${tag}>`;
  }

  function renderBlockquote(block: Block): string {
    const text = block.content
      .split("\n")
      .map((l) => l.replace(/^>\s?/, ""))
      .join("\n");
    return `<blockquote>${renderInlineMarkdown(text)}</blockquote>`;
  }

  function renderTable(block: Block): string {
    const lines = block.content.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return `<p>${block.content}</p>`;

    const parseRow = (line: string) =>
      line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c);

    const headers = parseRow(lines[0]);
    const rows = lines.slice(2).map(parseRow);

    let html = "<table><thead><tr>";
    headers.forEach((h) => (html += `<th>${renderInlineMarkdown(h)}</th>`));
    html += "</tr></thead><tbody>";
    rows.forEach((row) => {
      html += "<tr>";
      row.forEach((cell) => (html += `<td>${renderInlineMarkdown(cell)}</td>`));
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }

  function renderBlock(block: Block): string {
    switch (block.type) {
      case "heading":
        return renderHeading(block);
      case "code":
        return renderCode(block);
      case "list":
        return renderList(block);
      case "blockquote":
        return renderBlockquote(block);
      case "table":
        return renderTable(block);
      case "paragraph":
        return `<p>${renderInlineMarkdown(block.content)}</p>`;
    }
  }
</script>

<svelte:document onclick={handleDocumentClick} />

{#if activeSnippet}
  <FileSnippetPanel
    snippet={activeSnippet}
    {theme}
    onClose={() => (activeSnippet = null)}
  />
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
<div class="plan-viewer" role="presentation" onclick={handleFileRefClick}>
  {#each blocks as block (block.id)}
    <div class="block-row {block.type}">
      <div class="gutter" role="presentation">
        {#each { length: getLineCount(block) } as _, idx}
          {@const lineNum = block.startLine + idx}
          <div
            class="gutter-line"
            class:highlighted={isLineHighlighted(lineNum)}
          >
            <span class="line-number">{lineNum}</span>
          </div>
        {/each}
      </div>
      <div class="btn-col" role="presentation">
        {#each { length: getLineCount(block) } as _, idx}
          {@const lineNum = block.startLine + idx}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="btn-line"
            onmouseenter={() => (hoveredLine = lineNum)}
            onmouseleave={() => {
              if (hoveredLine === lineNum) hoveredLine = null;
            }}
          >
            <button
              class="add-comment-btn"
              class:visible={hoveredLine === lineNum}
              onclick={(e) => handlePlusClick(e, lineNum)}
              aria-label="Add comment to line {lineNum}">+</button
            >
          </div>
        {/each}
      </div>
      <div
        class="content"
        class:has-annotation={getAnnotationsEndingAtBlock(block).length > 0}
      >
        {@html renderBlock(block)}
      </div>
    </div>
    {#each getAnnotationsEndingAtBlock(block) as ann (ann.id)}
      <div class="comment-wrapper">
        <InlineComment
          annotation={ann}
          editing={editingId === ann.id}
          onSave={handleSave}
          onCancel={handleCancel}
          onDelete={onRemoveAnnotation}
          onEdit={(id) => (editingId = id)}
        />
      </div>
    {/each}
  {/each}
</div>

<style>
  .plan-viewer {
    font-size: 0.95rem;
  }

  .block-row {
    display: grid;
    grid-template-columns: 40px 28px 1fr;
    gap: 0;
  }

  .gutter {
    display: flex;
    flex-direction: column;
    user-select: none;
    border-right: 1px solid var(--color-border-muted);
  }

  .gutter-line {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 8px 0 4px;
    min-height: 1.6em;
  }

  .gutter-line.highlighted {
    background: var(--color-annotated-bg);
  }

  .line-number {
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    opacity: 0.5;
    text-align: right;
    line-height: 1.6;
  }

  .btn-col {
    display: flex;
    flex-direction: column;
    user-select: none;
  }

  .btn-line {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 1.6em;
  }

  .add-comment-btn {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid var(--color-border);
    background: var(--color-bg-subtle);
    color: var(--color-accent);
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    opacity: 0;
    transition:
      opacity 0.1s,
      background 0.1s,
      color 0.1s,
      border-color 0.1s;
    flex-shrink: 0;
  }

  .add-comment-btn.visible {
    opacity: 1;
  }

  .add-comment-btn:hover {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: #fff;
  }

  .content {
    padding: 0 8px;
    min-width: 0;
  }

  /* Align gutter line numbers with content for each block type */
  .block-row.heading .gutter,
  .block-row.heading .btn-col {
    padding-top: 20px;
  }
  .block-row.paragraph .gutter,
  .block-row.paragraph .btn-col {
    padding-top: 8px;
  }
  .block-row.code .gutter,
  .block-row.code .btn-col {
    padding-top: 28px;
  }
  .block-row.blockquote .gutter,
  .block-row.blockquote .btn-col {
    padding-top: 8px;
  }
  .block-row.table .gutter,
  .block-row.table .btn-col {
    padding-top: 12px;
  }

  /* Heading styles */
  .block-row :global(h1) {
    font-size: 1.75rem;
    margin: 24px 0 12px;
    color: var(--color-text-emphasis);
    border-bottom: 1px solid var(--color-border-muted);
    padding-bottom: 8px;
  }
  .block-row :global(h2) {
    font-size: 1.4rem;
    margin: 20px 0 10px;
    color: var(--color-text-emphasis);
  }
  .block-row :global(h3) {
    font-size: 1.15rem;
    margin: 16px 0 8px;
    color: var(--color-text-emphasis);
  }
  .block-row :global(h4),
  .block-row :global(h5),
  .block-row :global(h6) {
    font-size: 1rem;
    margin: 12px 0 6px;
    color: var(--color-text-emphasis);
  }

  /* Paragraph */
  .block-row :global(p) {
    margin: 8px 0;
  }

  /* Code */
  .block-row :global(pre) {
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 16px;
    overflow-x: auto;
    margin: 12px 0;
  }
  .block-row :global(code) {
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.85rem;
  }
  .block-row :global(.inline-code) {
    background: var(--color-bg-inset);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.85em;
  }
  .block-row :global(.file-ref) {
    cursor: pointer;
    border-bottom: 1px dashed var(--color-link);
    color: var(--color-link);
    transition: background 0.1s;
  }
  .block-row :global(.file-ref:hover) {
    background: rgba(88, 166, 255, 0.1);
  }

  /* List */
  .block-row.list .content {
    padding-top: 0;
    padding-bottom: 0;
  }
  .block-row :global(ul),
  .block-row :global(ol) {
    padding-left: 24px;
    margin: 0;
  }
  .block-row :global(li) {
    margin: 2px 0;
  }

  /* Blockquote */
  .block-row :global(blockquote) {
    border-left: 3px solid var(--color-border);
    padding: 4px 16px;
    color: var(--color-text-muted);
    margin: 8px 0;
  }

  /* Table */
  .block-row :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
  }
  .block-row :global(th),
  .block-row :global(td) {
    border: 1px solid var(--color-border);
    padding: 8px 12px;
    text-align: left;
  }
  .block-row :global(th) {
    background: var(--color-bg-subtle);
    font-weight: 600;
  }

  /* Diff */
  .block-row :global(.diff-block) {
    padding: 0;
  }
  .block-row :global(.diff-block code) {
    display: block;
    padding: 16px;
  }
  .block-row :global(.diff-add) {
    display: inline-block;
    width: 100%;
    background: var(--color-diff-add-bg);
    color: var(--color-diff-add-text);
  }
  .block-row :global(.diff-remove) {
    display: inline-block;
    width: 100%;
    background: var(--color-diff-remove-bg);
    color: var(--color-diff-remove-text);
  }
  .block-row :global(.diff-hunk) {
    display: inline-block;
    width: 100%;
    color: var(--color-diff-hunk);
  }
  .block-row :global(.diff-context) {
    display: inline-block;
    width: 100%;
  }

  /* Links & emphasis */
  .block-row :global(a) {
    color: var(--color-link);
    text-decoration: none;
  }
  .block-row :global(a:hover) {
    text-decoration: underline;
  }
  .block-row :global(strong) {
    color: var(--color-text-emphasis);
  }

  /* Comment wrapper — full width below block row */
  .comment-wrapper {
    margin-left: 68px;
    padding: 0 8px;
  }
</style>
