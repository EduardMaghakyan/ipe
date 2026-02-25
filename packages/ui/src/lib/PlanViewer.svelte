<script lang="ts">
  import type { LineAnnotation, PlanLine, FileSnippet } from "../types";
  import type { CollapsedDiffItem } from "../utils/diff";
  import { escapeHtml } from "../utils/diff";
  import InlineComment from "./InlineComment.svelte";
  import FileSnippetPanel from "./FileSnippetPanel.svelte";

  interface Props {
    lines: PlanLine[];
    annotations: LineAnnotation[];
    fileSnippets?: FileSnippet[];
    diffLines?: CollapsedDiffItem[] | null;
    theme: "dark" | "light";
    onAddAnnotation: (a: LineAnnotation) => void;
    onRemoveAnnotation: (id: string) => void;
    onUpdateAnnotation: (id: string, comment: string) => void;
  }

  let {
    lines,
    annotations,
    fileSnippets = [],
    diffLines = null,
    theme,
    onAddAnnotation,
    onRemoveAnnotation,
    onUpdateAnnotation,
  }: Props = $props();

  let editingId = $state<string | null>(null);
  let activeSnippet = $state<FileSnippet | null>(null);
  let hoveredLine = $state<number | null>(null);
  let selectionAnchor = $state<number | null>(null);
  let dragging = $state(false);
  let dragStart = $state<number | null>(null);
  let dragEnd = $state<number | null>(null);

  let dragRange = $derived.by(() => {
    if (!dragging || dragStart === null || dragEnd === null) return null;
    return {
      start: Math.min(dragStart, dragEnd),
      end: Math.max(dragStart, dragEnd),
    };
  });

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

  function isInDragRange(lineNum: number): boolean {
    if (!dragRange) return false;
    return lineNum >= dragRange.start && lineNum <= dragRange.end;
  }

  function isLineHovered(lineNum: number): boolean {
    return !dragging && hoveredLine === lineNum;
  }

  function isLineHighlighted(lineNum: number): boolean {
    return highlightedLines.has(lineNum);
  }

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

  function handlePlusMouseDown(e: MouseEvent, lineNum: number) {
    e.preventDefault();
    if (e.shiftKey && selectionAnchor !== null) {
      const start = Math.min(selectionAnchor, lineNum);
      const end = Math.max(selectionAnchor, lineNum);
      createAnnotationForRange(start, end);
      selectionAnchor = null;
    } else {
      dragging = true;
      dragStart = lineNum;
      dragEnd = lineNum;
    }
  }

  function handleDragEnter(lineNum: number) {
    if (dragging) {
      dragEnd = lineNum;
    }
  }

  function handleDocumentMouseUp() {
    if (!dragging || dragStart === null || dragEnd === null) return;
    const start = Math.min(dragStart, dragEnd);
    const end = Math.max(dragStart, dragEnd);
    createAnnotationForRange(start, end);
    selectionAnchor = start;
    dragging = false;
    dragStart = null;
    dragEnd = null;
  }

  function createAnnotationForRange(start: number, end: number) {
    const rawText = lines
      .filter((l) => l.lineNumber >= start && l.lineNumber <= end && !l.isBlank)
      .map((l) => l.raw)
      .join("\n");
    const id = `ann-${Date.now()}`;
    onAddAnnotation({
      id,
      startLine: start,
      endLine: end,
      selectedText: rawText,
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

  function getAnnotationsEndingAtLine(lineNum: number): LineAnnotation[] {
    return annotations.filter((a) => a.endLine === lineNum);
  }
</script>

<svelte:document
  onclick={handleDocumentClick}
  onmouseup={handleDocumentMouseUp}
/>

{#if activeSnippet}
  <FileSnippetPanel
    snippet={activeSnippet}
    {theme}
    onClose={() => (activeSnippet = null)}
  />
{/if}

{#if diffLines}
  <div class="inline-diff">
    {#each diffLines as item, i (i)}
      {#if item.type === "fold"}
        <div class="diff-fold-row">{"⋯"} {item.count} hidden lines</div>
      {:else}
        <div class="diff-row diff-{item.type}">
          <span class="diff-marker"
            >{item.type === "add"
              ? "+"
              : item.type === "remove"
                ? "-"
                : " "}</span
          >
          <span class="diff-text">{item.content}</span>
        </div>
      {/if}
    {/each}
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div class="plan-viewer" role="presentation" onclick={handleFileRefClick}>
    {#each lines as line (line.lineNumber)}
      {#if line.isBlank}
        <div class="plan-line blank">
          <div class="gutter-cell"></div>
          <div class="btn-cell"></div>
          <div class="content-cell"></div>
        </div>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="plan-line {line.blockType} pos-{line.blockPosition}"
          class:fence={line.isFence}
          class:highlighted={isLineHighlighted(line.lineNumber)}
          class:line-hovered={isLineHovered(line.lineNumber)}
          class:drag-selected={isInDragRange(line.lineNumber)}
        >
          <div class="gutter-cell">
            <span class="line-number">{line.lineNumber}</span>
          </div>
          <div
            class="btn-cell"
            onmouseenter={() => {
              hoveredLine = line.lineNumber;
              handleDragEnter(line.lineNumber);
            }}
            onmouseleave={() => {
              if (hoveredLine === line.lineNumber && !dragging)
                hoveredLine = null;
            }}
          >
            <button
              class="add-comment-btn"
              class:visible={hoveredLine === line.lineNumber ||
                isInDragRange(line.lineNumber)}
              onmousedown={(e) => handlePlusMouseDown(e, line.lineNumber)}
              aria-label="Add comment to line {line.lineNumber}">+</button
            >
          </div>
          <div class="content-cell">
            {@html line.html}
          </div>
        </div>
      {/if}
      {#each getAnnotationsEndingAtLine(line.lineNumber) as ann (ann.id)}
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
{/if}

<style>
  .plan-viewer {
    font-size: 0.95rem;
  }

  .plan-line {
    display: grid;
    grid-template-columns: 40px 28px 1fr;
    min-height: 1.6em;
  }

  .plan-line.blank {
    min-height: 8px;
  }

  /* Hover and drag selection — full row highlight */
  .plan-line.line-hovered,
  .plan-line.drag-selected {
    box-shadow:
      inset 0 1px 0 var(--color-accent),
      inset 0 -1px 0 var(--color-accent);
    background: var(--color-annotated-bg);
  }

  .plan-line.highlighted {
    background: var(--color-annotated-bg);
  }

  /* Override content-cell background (e.g. code blocks) when row is active */
  .plan-line.line-hovered .content-cell,
  .plan-line.drag-selected .content-cell,
  .plan-line.highlighted .content-cell {
    background: transparent;
  }

  /* Gutter */
  .gutter-cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 8px 0 4px;
    user-select: none;
    border-right: 1px solid var(--color-border-muted);
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

  /* Button column */
  .btn-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
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

  /* Content cell */
  .content-cell {
    padding: 0 8px;
    min-width: 0;
    line-height: 1.6;
  }

  /* --- Block type styles --- */

  /* Heading */
  .plan-line.heading .content-cell :global(.heading-text) {
    color: var(--color-text-emphasis);
    font-weight: 600;
  }
  .plan-line.heading .content-cell :global(.h1) {
    font-size: 1.75rem;
  }
  .plan-line.heading .content-cell :global(.h2) {
    font-size: 1.4rem;
  }
  .plan-line.heading .content-cell :global(.h3) {
    font-size: 1.15rem;
  }
  .plan-line.heading .content-cell :global(.h4),
  .plan-line.heading .content-cell :global(.h5),
  .plan-line.heading .content-cell :global(.h6) {
    font-size: 1rem;
  }
  .plan-line.heading {
    margin-top: 16px;
  }
  .plan-line.heading.pos-only .content-cell {
    padding-top: 8px;
    padding-bottom: 4px;
  }

  /* Paragraph */
  .plan-line.paragraph .content-cell :global(.p-line) {
    display: inline;
  }
  .plan-line.paragraph.pos-first,
  .plan-line.paragraph.pos-only {
    margin-top: 4px;
  }
  .plan-line.paragraph.pos-last,
  .plan-line.paragraph.pos-only {
    margin-bottom: 4px;
  }

  /* Code — visual grouping via connected backgrounds */
  .plan-line.code .content-cell {
    background: var(--color-bg-subtle);
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.85rem;
    padding: 0 16px;
    border-left: 1px solid var(--color-border);
    border-right: 1px solid var(--color-border);
  }
  .plan-line.code.pos-first .content-cell {
    border-top: 1px solid var(--color-border);
    border-radius: 6px 6px 0 0;
    padding-top: 4px;
  }
  .plan-line.code.pos-last .content-cell {
    border-bottom: 1px solid var(--color-border);
    border-radius: 0 0 6px 6px;
    padding-bottom: 4px;
  }
  .plan-line.code.pos-only .content-cell {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .plan-line.fence .content-cell :global(.code-fence) {
    color: var(--color-text-muted);
    opacity: 0.5;
    font-size: 0.8rem;
  }
  .plan-line.code .content-cell :global(.code-line) {
    display: block;
    white-space: pre;
  }

  /* Diff styles within code */
  .plan-line.code .content-cell :global(.diff-add) {
    background: var(--color-diff-add-bg);
    color: var(--color-diff-add-text);
  }
  .plan-line.code .content-cell :global(.diff-remove) {
    background: var(--color-diff-remove-bg);
    color: var(--color-diff-remove-text);
  }
  .plan-line.code .content-cell :global(.diff-hunk) {
    color: var(--color-diff-hunk);
  }

  /* List */
  .plan-line.list .content-cell :global(.list-item) {
    display: block;
    padding-left: 8px;
  }
  .plan-line.list .content-cell :global(.list-marker) {
    display: inline-block;
    width: 1.5em;
    color: var(--color-text-muted);
  }

  /* Blockquote */
  .plan-line.blockquote .content-cell {
    border-left: 3px solid var(--color-border);
    padding-left: 16px;
    color: var(--color-text-muted);
  }

  /* Table */
  .plan-line.table .content-cell :global(.table-row-line) {
    width: 100%;
    border-collapse: collapse;
  }
  .plan-line.table .content-cell :global(th),
  .plan-line.table .content-cell :global(td) {
    border: 1px solid var(--color-border);
    padding: 4px 12px;
    text-align: left;
  }
  .plan-line.table .content-cell :global(th) {
    background: var(--color-bg-subtle);
    font-weight: 600;
  }
  .plan-line.table .content-cell :global(.table-separator) {
    display: none;
  }

  /* Inline code & file refs */
  .content-cell :global(.inline-code) {
    background: var(--color-bg-inset);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.85em;
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
  }
  .content-cell :global(.file-ref) {
    cursor: pointer;
    border-bottom: 1px dashed var(--color-link);
    color: var(--color-link);
    transition: background 0.1s;
  }
  .content-cell :global(.file-ref:hover) {
    background: rgba(88, 166, 255, 0.1);
  }

  /* Links & emphasis */
  .content-cell :global(a) {
    color: var(--color-link);
    text-decoration: none;
  }
  .content-cell :global(a:hover) {
    text-decoration: underline;
  }
  .content-cell :global(strong) {
    color: var(--color-text-emphasis);
  }

  /* Comment wrapper */
  .comment-wrapper {
    margin-left: 68px;
    padding: 0 8px;
  }

  /* Inline diff view */
  .inline-diff {
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .diff-row {
    display: flex;
    padding: 0 8px;
    white-space: pre-wrap;
    min-height: 1.5em;
  }
  .diff-row.diff-add {
    background: var(--color-diff-add-bg);
    color: var(--color-diff-add-text);
  }
  .diff-row.diff-remove {
    background: var(--color-diff-remove-bg);
    color: var(--color-diff-remove-text);
  }
  .diff-row.diff-context {
    color: var(--color-text-muted);
  }
  .diff-marker {
    display: inline-block;
    width: 1.5em;
    flex-shrink: 0;
    user-select: none;
  }
  .diff-text {
    flex: 1;
    min-width: 0;
  }
  .diff-fold-row {
    padding: 4px 8px;
    text-align: center;
    color: var(--color-text-muted);
    font-style: italic;
    background: var(--color-bg-subtle);
    border-top: 1px solid var(--color-border-muted);
    border-bottom: 1px solid var(--color-border-muted);
  }
</style>
