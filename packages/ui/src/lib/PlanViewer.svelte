<script lang="ts">
  import type { Annotation, Block, FileSnippet } from "../types";
  import { isDiffContent, escapeHtml } from "../utils/diff";
  import SelectionPopup from "./SelectionPopup.svelte";
  import InlineComment from "./InlineComment.svelte";
  import FileSnippetPanel from "./FileSnippetPanel.svelte";

  interface Props {
    blocks: Block[];
    annotations: Annotation[];
    fileSnippets?: FileSnippet[];
    theme: "dark" | "light";
    onAddAnnotation: (a: Annotation) => void;
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

  let popup = $state<{
    x: number;
    y: number;
    blockId: string;
    text: string;
  } | null>(null);
  let editingId = $state<string | null>(null);
  let activeSnippet = $state<FileSnippet | null>(null);

  // Build a lookup map from file paths to snippets
  let snippetMap = $derived.by(() => {
    const map = new Map<string, FileSnippet>();
    for (const s of fileSnippets) {
      map.set(s.path, s);
    }
    return map;
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

  function handleMouseUp(blockId: string) {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!sel || sel.isCollapsed || !text) {
      popup = null;
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    popup = {
      x: rect.left + rect.width / 2,
      y: rect.top,
      blockId,
      text,
    };
  }

  function handleAddComment() {
    if (!popup) return;
    const id = `ann-${Date.now()}`;
    onAddAnnotation({
      id,
      blockId: popup.blockId,
      selectedText: popup.text,
      comment: "",
    });
    editingId = id;
    popup = null;
    window.getSelection()?.removeAllRanges();
  }

  function handlePlusClick(blockId: string) {
    const block = blocks.find((b) => b.id === blockId);
    const id = `ann-${Date.now()}`;
    onAddAnnotation({
      id,
      blockId,
      selectedText: block?.content ?? "",
      comment: "",
    });
    editingId = id;
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

  function handleDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (
      !target.closest(".popup") &&
      !window.getSelection()?.toString().trim()
    ) {
      popup = null;
    }
    if (
      !target.closest(".file-snippet-panel") &&
      !target.closest("[data-file-path]")
    ) {
      activeSnippet = null;
    }
  }

  function getBlockAnnotations(blockId: string): Annotation[] {
    return annotations.filter((a) => a.blockId === blockId);
  }

  function hasAnnotation(blockId: string): boolean {
    return annotations.some((a) => a.blockId === blockId);
  }

  function renderInlineMarkdown(text: string): string {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, (_match, code: string) => {
        // Strip line ref suffix to check against snippet map
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
    const startAttr = isOrdered && block.listStart ? ` start="${block.listStart}"` : "";
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

{#if popup}
  <SelectionPopup x={popup.x} y={popup.y} onAddComment={handleAddComment} />
{/if}

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
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="block {block.type}"
      class:annotated={hasAnnotation(block.id)}
      role="region"
      onmouseup={() => handleMouseUp(block.id)}
    >
      <button
        class="add-comment-btn"
        onclick={() => handlePlusClick(block.id)}
        aria-label="Add comment to block">+</button
      >
      {@html renderBlock(block)}
    </div>
    {#each getBlockAnnotations(block.id) as ann (ann.id)}
      <InlineComment
        annotation={ann}
        editing={editingId === ann.id}
        onSave={handleSave}
        onCancel={handleCancel}
        onDelete={onRemoveAnnotation}
        onEdit={(id) => (editingId = id)}
      />
    {/each}
  {/each}
</div>

<style>
  .plan-viewer {
    font-size: 0.95rem;
  }
  .block {
    position: relative;
    padding: 2px 4px 2px 4px;
    border-radius: 4px;
    border-left: 3px solid transparent;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  /* Extend hover hit area into the left gutter */
  .block::before {
    content: "";
    position: absolute;
    left: -32px;
    top: 0;
    width: 32px;
    height: 100%;
  }
  .block.annotated {
    border-left-color: var(--color-annotated-border);
    background: var(--color-annotated-bg);
  }
  .add-comment-btn {
    position: absolute;
    left: -28px;
    top: 50%;
    transform: translateY(-50%);
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid var(--color-border);
    background: var(--color-bg-subtle);
    color: var(--color-accent);
    font-size: 15px;
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
    z-index: 10;
  }
  .block:hover .add-comment-btn {
    opacity: 1;
  }
  .add-comment-btn:hover {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: #fff;
  }
  .block :global(h1) {
    font-size: 1.75rem;
    margin: 24px 0 12px;
    color: var(--color-text-emphasis);
    border-bottom: 1px solid var(--color-border-muted);
    padding-bottom: 8px;
  }
  .block :global(h2) {
    font-size: 1.4rem;
    margin: 20px 0 10px;
    color: var(--color-text-emphasis);
  }
  .block :global(h3) {
    font-size: 1.15rem;
    margin: 16px 0 8px;
    color: var(--color-text-emphasis);
  }
  .block :global(h4),
  .block :global(h5),
  .block :global(h6) {
    font-size: 1rem;
    margin: 12px 0 6px;
    color: var(--color-text-emphasis);
  }
  .block :global(p) {
    margin: 8px 0;
  }
  .block :global(pre) {
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 16px;
    overflow-x: auto;
    margin: 12px 0;
  }
  .block :global(code) {
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.85rem;
  }
  .block :global(.inline-code) {
    background: var(--color-bg-inset);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.85em;
  }
  .block :global(.file-ref) {
    cursor: pointer;
    border-bottom: 1px dashed var(--color-link);
    color: var(--color-link);
    transition: background 0.1s;
  }
  .block :global(.file-ref:hover) {
    background: rgba(88, 166, 255, 0.1);
  }
  .block.list {
    padding-top: 0;
    padding-bottom: 0;
  }
  .block :global(ul),
  .block :global(ol) {
    padding-left: 24px;
    margin: 0;
  }
  .block :global(li) {
    margin: 2px 0;
  }
  .block :global(blockquote) {
    border-left: 3px solid var(--color-border);
    padding: 4px 16px;
    color: var(--color-text-muted);
    margin: 8px 0;
  }
  .block :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
  }
  .block :global(th),
  .block :global(td) {
    border: 1px solid var(--color-border);
    padding: 8px 12px;
    text-align: left;
  }
  .block :global(th) {
    background: var(--color-bg-subtle);
    font-weight: 600;
  }
  .block :global(.diff-block) {
    padding: 0;
  }
  .block :global(.diff-block code) {
    display: block;
    padding: 16px;
  }
  .block :global(.diff-add) {
    display: inline-block;
    width: 100%;
    background: var(--color-diff-add-bg);
    color: var(--color-diff-add-text);
  }
  .block :global(.diff-remove) {
    display: inline-block;
    width: 100%;
    background: var(--color-diff-remove-bg);
    color: var(--color-diff-remove-text);
  }
  .block :global(.diff-hunk) {
    display: inline-block;
    width: 100%;
    color: var(--color-diff-hunk);
  }
  .block :global(.diff-context) {
    display: inline-block;
    width: 100%;
  }
  .block :global(a) {
    color: var(--color-link);
    text-decoration: none;
  }
  .block :global(a:hover) {
    text-decoration: underline;
  }
  .block :global(strong) {
    color: var(--color-text-emphasis);
  }
</style>
