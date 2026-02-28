<script lang="ts">
  import type { UnitAnnotation, AnnotatableUnit, FileSnippet } from "../types";
  import type { CollapsedDiffItem } from "../utils/diff";
  import InlineComment from "./InlineComment.svelte";
  import FileSnippetPanel from "./FileSnippetPanel.svelte";

  interface Props {
    html: string;
    units: AnnotatableUnit[];
    codeBlockMap: Map<string, string>;
    annotations: UnitAnnotation[];
    fileSnippets?: FileSnippet[];
    diffLines?: CollapsedDiffItem[] | null;
    theme: "dark" | "light";
    onAddAnnotation: (a: UnitAnnotation) => void;
    onRemoveAnnotation: (id: string) => void;
    onUpdateAnnotation: (id: string, comment: string) => void;
  }

  let {
    html,
    units,
    codeBlockMap,
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
  let contentEl: HTMLDivElement | undefined = $state();

  // Gutter button positioning
  let unitPositions = $state<Map<string, { top: number; height: number }>>(
    new Map(),
  );

  // Drag state for multi-unit selection
  let dragging = $state(false);
  let dragStartUnit = $state<string | null>(null);
  let dragEndUnit = $state<string | null>(null);
  let hoveredUnit = $state<string | null>(null);

  // Build snippet lookup
  let snippetMap = $derived.by(() => {
    const map = new Map<string, FileSnippet>();
    for (const s of fileSnippets) {
      map.set(s.path, s);
    }
    return map;
  });

  // Compute drag range as unit index range
  let dragRange = $derived.by(() => {
    if (!dragging || !dragStartUnit || !dragEndUnit) return null;
    const startIdx = units.findIndex((u) => u.id === dragStartUnit);
    const endIdx = units.findIndex((u) => u.id === dragEndUnit);
    if (startIdx === -1 || endIdx === -1) return null;
    return {
      start: Math.min(startIdx, endIdx),
      end: Math.max(startIdx, endIdx),
    };
  });

  // Set of unit IDs in the current drag selection
  let dragSelectedIds = $derived.by(() => {
    if (!dragRange) return new Set<string>();
    const ids = new Set<string>();
    for (let i = dragRange.start; i <= dragRange.end; i++) {
      ids.add(units[i].id);
    }
    return ids;
  });

  // Set of unit IDs covered by annotations
  let highlightedUnitIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const ann of annotations) {
      const startIdx = units.findIndex((u) => u.id === ann.startUnitId);
      const endIdx = units.findIndex((u) => u.id === ann.endUnitId);
      if (startIdx === -1 || endIdx === -1) continue;
      for (let i = startIdx; i <= endIdx; i++) {
        ids.add(units[i].id);
      }
    }
    return ids;
  });

  // Resolve annotation endUnitId to split-point ID (handles code-line to code-block mapping)
  function resolveEndUnitId(endUnitId: string): string {
    return codeBlockMap.get(endUnitId) ?? endUnitId;
  }

  // Split HTML at annotation boundaries for inline comment rendering
  function splitHtmlAtAnnotations(
    fullHtml: string,
    endUnitIds: Set<string>,
  ): { html: string; endUnitId: string | null }[] {
    if (endUnitIds.size === 0) {
      return [{ html: fullHtml, endUnitId: null }];
    }

    const segments: { html: string; endUnitId: string | null }[] = [];
    const markerPattern = /<!-- unit-end:(u-\d+) -->/g;
    let lastIndex = 0;
    let match;

    while ((match = markerPattern.exec(fullHtml)) !== null) {
      const unitId = match[1];
      if (endUnitIds.has(unitId)) {
        const endPos = match.index + match[0].length;
        segments.push({
          html: fullHtml.slice(lastIndex, endPos),
          endUnitId: unitId,
        });
        lastIndex = endPos;
      }
    }

    // Remaining HTML after last split
    if (lastIndex < fullHtml.length) {
      segments.push({
        html: fullHtml.slice(lastIndex),
        endUnitId: null,
      });
    }

    return segments;
  }

  // Collect resolved end-unit IDs for all annotations
  let annotationEndUnitIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const ann of annotations) {
      ids.add(resolveEndUnitId(ann.endUnitId));
    }
    return ids;
  });

  // Build a map from resolved endUnitId to annotations
  let annotationsByResolvedEnd = $derived.by(() => {
    const map = new Map<string, UnitAnnotation[]>();
    for (const ann of annotations) {
      const resolved = resolveEndUnitId(ann.endUnitId);
      const list = map.get(resolved) ?? [];
      list.push(ann);
      map.set(resolved, list);
    }
    return map;
  });

  // Split HTML into segments with interleaved annotation points
  let segments = $derived.by(() => {
    return splitHtmlAtAnnotations(html, annotationEndUnitIds);
  });

  // Measure unit positions after HTML renders
  $effect(() => {
    void html;
    void annotations; // re-measure when annotations change layout
    if (!contentEl) return;

    requestAnimationFrame(() => {
      if (!contentEl) return;
      const map = new Map<string, { top: number; height: number }>();
      const containerRect = contentEl.getBoundingClientRect();
      const elements = contentEl.querySelectorAll("[data-unit-id]");
      for (const el of elements) {
        const id = el.getAttribute("data-unit-id")!;
        const rect = el.getBoundingClientRect();
        map.set(id, {
          top: rect.top - containerRect.top + contentEl.scrollTop,
          height: rect.height,
        });
      }
      unitPositions = map;
    });
  });

  // Apply highlight classes to DOM elements
  $effect(() => {
    if (!contentEl) return;
    // Clear all highlights
    contentEl
      .querySelectorAll(".unit-highlighted")
      .forEach((el) => el.classList.remove("unit-highlighted"));
    contentEl
      .querySelectorAll(".unit-drag-selected")
      .forEach((el) => el.classList.remove("unit-drag-selected"));
    contentEl
      .querySelectorAll(".unit-hovered")
      .forEach((el) => el.classList.remove("unit-hovered"));

    // Apply annotation highlights
    for (const id of highlightedUnitIds) {
      const el = contentEl.querySelector(`[data-unit-id="${id}"]`);
      el?.classList.add("unit-highlighted");
    }

    // Apply drag selection
    for (const id of dragSelectedIds) {
      const el = contentEl.querySelector(`[data-unit-id="${id}"]`);
      el?.classList.add("unit-drag-selected");
    }

    // Apply hover
    if (hoveredUnit && !dragging) {
      const el = contentEl.querySelector(`[data-unit-id="${hoveredUnit}"]`);
      el?.classList.add("unit-hovered");
    }
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

  function handleContentMouseOver(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest("[data-unit-id]");
    if (target) {
      const unitId = target.getAttribute("data-unit-id")!;
      hoveredUnit = unitId;
      if (dragging) dragEndUnit = unitId;
    }
  }

  function handleContentMouseOut(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest("[data-unit-id]");
    const related = (e.relatedTarget as HTMLElement | null)?.closest(
      "[data-unit-id]",
    );
    if (target && target !== related && !dragging) {
      hoveredUnit = null;
    }
  }

  function handlePlusMouseDown(e: MouseEvent, unitId: string) {
    e.preventDefault();
    dragging = true;
    dragStartUnit = unitId;
    dragEndUnit = unitId;
  }

  function handleGutterEnter(unitId: string) {
    hoveredUnit = unitId;
    if (dragging) {
      dragEndUnit = unitId;
    }
  }

  function handleGutterLeave(unitId: string) {
    if (hoveredUnit === unitId && !dragging) {
      hoveredUnit = null;
    }
  }

  function handleDocumentMouseUp() {
    if (!dragging || !dragStartUnit || !dragEndUnit) return;
    const startIdx = units.findIndex((u) => u.id === dragStartUnit);
    const endIdx = units.findIndex((u) => u.id === dragEndUnit);
    if (startIdx === -1 || endIdx === -1) {
      dragging = false;
      dragStartUnit = null;
      dragEndUnit = null;
      return;
    }
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const selectedUnits = units.slice(lo, hi + 1);
    const rawText = selectedUnits.map((u) => u.rawText).join("\n");

    const id = `ann-${Date.now()}`;
    onAddAnnotation({
      id,
      startUnitId: units[lo].id,
      endUnitId: units[hi].id,
      selectedText: rawText,
      comment: "",
    });
    editingId = id;
    dragging = false;
    dragStartUnit = null;
    dragEndUnit = null;
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

  // Collect gutter items (+ buttons only)
  let gutterItems = $derived.by(() => {
    return units
      .map((unit) => {
        const pos = unitPositions.get(unit.id);
        if (!pos) return null;
        return {
          unitId: unit.id,
          top: pos.top,
          height: pos.height,
        };
      })
      .filter(Boolean) as Array<{
      unitId: string;
      top: number;
      height: number;
    }>;
  });
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
  <div class="plan-viewer-container" role="presentation">
    <!-- Gutter overlay with + buttons only -->
    <div class="gutter-overlay">
      {#each gutterItems as item (item.unitId)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="gutter-item"
          style="top: {item.top}px; height: {item.height}px;"
          onmouseenter={() => handleGutterEnter(item.unitId)}
          onmouseleave={() => handleGutterLeave(item.unitId)}
        >
          <button
            class="add-comment-btn"
            class:visible={hoveredUnit === item.unitId ||
              dragSelectedIds.has(item.unitId)}
            onmousedown={(e) => handlePlusMouseDown(e, item.unitId)}
            aria-label="Add comment">+</button
          >
        </div>
      {/each}
    </div>

    <!-- Content area with interleaved inline comments -->
    <div
      class="content-area"
      bind:this={contentEl}
      onclick={handleFileRefClick}
      onmouseover={handleContentMouseOver}
      onmouseout={handleContentMouseOut}
    >
      {#each segments as seg, i (i)}
        {@html seg.html}
        {#if seg.endUnitId}
          {#each annotationsByResolvedEnd.get(seg.endUnitId) ?? [] as ann (ann.id)}
            <div class="annotation-inline">
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
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .plan-viewer-container {
    position: relative;
    font-size: 0.95rem;
  }

  /* Gutter overlay */
  .gutter-overlay {
    position: absolute;
    left: -36px;
    top: 0;
    width: 28px;
    z-index: 5;
  }

  .gutter-item {
    position: absolute;
    width: 28px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 2px;
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

  /* Inline comment in document flow */
  .annotation-inline {
    margin: 8px 0;
  }

  /* Content area */
  .content-area {
    line-height: 1.6;
  }

  /* --- Markdown rendering styles --- */

  /* Headings */
  .content-area :global(h1),
  .content-area :global(h2),
  .content-area :global(h3),
  .content-area :global(h4),
  .content-area :global(h5),
  .content-area :global(h6) {
    color: var(--color-text-emphasis);
    font-weight: 600;
    margin-top: 24px;
    margin-bottom: 8px;
    padding-bottom: 4px;
  }
  .content-area :global(h1) {
    font-size: 1.75rem;
    border-bottom: 1px solid var(--color-border-muted);
    padding-bottom: 8px;
  }
  .content-area :global(h2) {
    font-size: 1.4rem;
    border-bottom: 1px solid var(--color-border-muted);
    padding-bottom: 6px;
  }
  .content-area :global(h3) {
    font-size: 1.15rem;
  }
  .content-area :global(h4),
  .content-area :global(h5),
  .content-area :global(h6) {
    font-size: 1rem;
  }
  .content-area :global(h1:first-child) {
    margin-top: 0;
  }

  /* Paragraphs */
  .content-area :global(p) {
    margin: 8px 0;
  }

  /* Code blocks */
  .content-area :global(.code-block) {
    margin: 12px 0;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow-x: auto;
  }
  .content-area :global(.code-block pre) {
    margin: 0;
    padding: 12px 16px;
    background: var(--color-bg-subtle);
    border-radius: 6px;
  }
  .content-area :global(.code-block code) {
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .content-area :global(.code-line) {
    display: block;
    white-space: pre;
    padding: 0 4px;
  }

  /* Diff styles within code */
  .content-area :global(.diff-add) {
    background: var(--color-diff-add-bg);
    color: var(--color-diff-add-text);
  }
  .content-area :global(.diff-remove) {
    background: var(--color-diff-remove-bg);
    color: var(--color-diff-remove-text);
  }
  .content-area :global(.diff-hunk) {
    color: var(--color-diff-hunk);
  }

  /* Lists */
  .content-area :global(ul),
  .content-area :global(ol) {
    padding-left: 24px;
    margin: 8px 0;
  }
  .content-area :global(li) {
    margin: 4px 0;
  }

  /* Blockquotes */
  .content-area :global(blockquote) {
    border-left: 3px solid var(--color-border);
    padding-left: 16px;
    color: var(--color-text-muted);
    margin: 8px 0;
  }

  /* Tables */
  .content-area :global(.plan-table) {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
  }
  .content-area :global(.plan-table th),
  .content-area :global(.plan-table td) {
    border: 1px solid var(--color-border);
    padding: 6px 12px;
    text-align: left;
  }
  .content-area :global(.plan-table th) {
    background: var(--color-bg-subtle);
    font-weight: 600;
  }

  /* Inline code & file refs */
  .content-area :global(.inline-code) {
    background: var(--color-bg-inset);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.85em;
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
  }
  .content-area :global(.file-ref) {
    cursor: pointer;
    border-bottom: 1px dashed var(--color-link);
    color: var(--color-link);
    transition: background 0.1s;
  }
  .content-area :global(.file-ref:hover) {
    background: rgba(88, 166, 255, 0.1);
  }

  /* Links & emphasis */
  .content-area :global(a) {
    color: var(--color-link);
    text-decoration: none;
  }
  .content-area :global(a:hover) {
    text-decoration: underline;
  }
  .content-area :global(strong) {
    color: var(--color-text-emphasis);
  }

  /* Horizontal rules */
  .content-area :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border-muted);
    margin: 16px 0;
  }

  /* Unit highlighting */
  .content-area :global(.unit-highlighted) {
    background: var(--color-annotated-bg);
    border-radius: 3px;
  }
  .content-area :global(.unit-hovered),
  .content-area :global(.unit-drag-selected) {
    background: var(--color-annotated-bg);
    box-shadow: inset 3px 0 0 var(--color-accent);
    border-radius: 3px;
  }

  /* Table cell highlight inheritance */
  .content-area :global(tr.unit-highlighted td),
  .content-area :global(tr.unit-hovered td),
  .content-area :global(tr.unit-drag-selected td) {
    background: inherit;
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
