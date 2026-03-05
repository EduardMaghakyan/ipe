<script lang="ts">
  import type { FileDiff, DiffAnnotation, DiffHunkLine } from "../types";
  import InlineComment from "./InlineComment.svelte";

  interface Props {
    file: FileDiff;
    annotations: DiffAnnotation[];
    onAddAnnotation: (a: DiffAnnotation) => void;
    onRemoveAnnotation: (id: string) => void;
    onUpdateAnnotation: (id: string, comment: string) => void;
  }

  let {
    file,
    annotations,
    onAddAnnotation,
    onRemoveAnnotation,
    onUpdateAnnotation,
  }: Props = $props();

  let editingId = $state<string | null>(null);
  let hoveredLineKey = $state<string | null>(null);
  let dragging = $state(false);
  let dragStartKey = $state<string | null>(null);
  let dragEndKey = $state<string | null>(null);

  // Build flat list of all lines with keys
  interface FlatLine {
    key: string;
    type: "hunk-header" | "add" | "remove" | "context";
    content: string;
    oldLineNo?: number;
    newLineNo?: number;
    hunkIdx: number;
    lineIdx: number;
  }

  let flatLines = $derived.by(() => {
    const lines: FlatLine[] = [];
    for (let hi = 0; hi < file.hunks.length; hi++) {
      const hunk = file.hunks[hi];
      lines.push({
        key: `hdr-${hi}`,
        type: "hunk-header",
        content: hunk.header,
        hunkIdx: hi,
        lineIdx: -1,
      });
      for (let li = 0; li < hunk.lines.length; li++) {
        const line = hunk.lines[li];
        lines.push({
          key: `h${hi}-l${li}`,
          type: line.type,
          content: line.content,
          oldLineNo: line.oldLineNo,
          newLineNo: line.newLineNo,
          hunkIdx: hi,
          lineIdx: li,
        });
      }
    }
    return lines;
  });

  // Map from line key to flat index
  let keyToIndex = $derived.by(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < flatLines.length; i++) {
      map.set(flatLines[i].key, i);
    }
    return map;
  });

  // Drag range
  let dragRange = $derived.by(() => {
    if (!dragging || !dragStartKey || !dragEndKey) return null;
    const startIdx = keyToIndex.get(dragStartKey);
    const endIdx = keyToIndex.get(dragEndKey);
    if (startIdx === undefined || endIdx === undefined) return null;
    return {
      start: Math.min(startIdx, endIdx),
      end: Math.max(startIdx, endIdx),
    };
  });

  let dragSelectedKeys = $derived.by(() => {
    if (!dragRange) return new Set<string>();
    const keys = new Set<string>();
    for (let i = dragRange.start; i <= dragRange.end; i++) {
      if (flatLines[i].type !== "hunk-header") {
        keys.add(flatLines[i].key);
      }
    }
    return keys;
  });

  // Highlighted lines (lines with annotations)
  let highlightedKeys = $derived.by(() => {
    const keys = new Set<string>();
    for (const ann of annotations) {
      const startIdx = keyToIndex.get(ann.startLineKey);
      const endIdx = keyToIndex.get(ann.endLineKey);
      if (startIdx === undefined || endIdx === undefined) continue;
      for (let i = startIdx; i <= endIdx; i++) {
        keys.add(flatLines[i].key);
      }
    }
    return keys;
  });

  // Annotations keyed by their endLineKey
  let annotationsByEndKey = $derived.by(() => {
    const map = new Map<string, DiffAnnotation[]>();
    for (const ann of annotations) {
      const list = map.get(ann.endLineKey) ?? [];
      list.push(ann);
      map.set(ann.endLineKey, list);
    }
    return map;
  });

  function filePath(): string {
    return file.status === "deleted" ? file.oldPath : file.newPath;
  }

  function handlePlusMouseDown(e: MouseEvent, key: string) {
    e.preventDefault();
    dragging = true;
    dragStartKey = key;
    dragEndKey = key;
  }

  function handleLineEnter(key: string) {
    hoveredLineKey = key;
    if (dragging) dragEndKey = key;
  }

  function handleLineLeave(key: string) {
    if (hoveredLineKey === key && !dragging) {
      hoveredLineKey = null;
    }
  }

  function handleDocumentMouseUp() {
    if (!dragging || !dragStartKey || !dragEndKey) return;
    const startIdx = keyToIndex.get(dragStartKey);
    const endIdx = keyToIndex.get(dragEndKey);
    if (startIdx === undefined || endIdx === undefined) {
      dragging = false;
      dragStartKey = null;
      dragEndKey = null;
      return;
    }
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);

    // Collect selected text from non-header lines
    const selectedLines: string[] = [];
    let startKey = flatLines[lo].key;
    let endKey = flatLines[hi].key;
    for (let i = lo; i <= hi; i++) {
      if (flatLines[i].type !== "hunk-header") {
        selectedLines.push(flatLines[i].content);
        if (i === lo) startKey = flatLines[i].key;
        endKey = flatLines[i].key;
      }
    }

    const id = `dann-${Date.now()}`;
    onAddAnnotation({
      id,
      filePath: filePath(),
      lineKey: startKey,
      startLineKey: startKey,
      endLineKey: endKey,
      selectedText: selectedLines.join("\n"),
      comment: "",
    });
    editingId = id;
    dragging = false;
    dragStartKey = null;
    dragEndKey = null;
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

  // Convert DiffAnnotation to UnitAnnotation shape for InlineComment
  function toUnitAnnotation(ann: DiffAnnotation) {
    return {
      id: ann.id,
      startUnitId: ann.startLineKey,
      endUnitId: ann.endLineKey,
      selectedText: ann.selectedText,
      comment: ann.comment,
    };
  }
</script>

<svelte:document onmouseup={handleDocumentMouseUp} />

<div class="diff-viewer">
  <div class="diff-file-header">
    <span class="file-path">{filePath()}</span>
    {#if file.status === "renamed" && file.oldPath !== file.newPath}
      <span class="rename-arrow">&larr;</span>
      <span class="old-path">{file.oldPath}</span>
    {/if}
  </div>

  <div class="diff-body">
    {#each flatLines as line (line.key)}
      {#if line.type === "hunk-header"}
        <div class="diff-line hunk-header">
          <span class="line-no"></span>
          <span class="line-no"></span>
          <span class="plus-gutter"></span>
          <span class="line-content hunk-text">{line.content}</span>
        </div>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_mouse_events_have_key_events -->
        <div
          class="diff-line line-{line.type}"
          class:highlighted={highlightedKeys.has(line.key)}
          class:drag-selected={dragSelectedKeys.has(line.key)}
          class:hovered={hoveredLineKey === line.key && !dragging}
          onmouseenter={() => handleLineEnter(line.key)}
          onmouseleave={() => handleLineLeave(line.key)}
        >
          <span class="line-no old-no">{line.oldLineNo ?? ""}</span>
          <span class="line-no new-no">{line.newLineNo ?? ""}</span>
          <span class="plus-gutter">
            <button
              class="add-comment-btn"
              class:visible={hoveredLineKey === line.key ||
                dragSelectedKeys.has(line.key)}
              onmousedown={(e) => handlePlusMouseDown(e, line.key)}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handlePlusMouseDown(e as any, line.key);
                  handleDocumentMouseUp();
                }
              }}
              aria-label="Add comment">+</button
            >
          </span>
          <span class="line-marker"
            >{line.type === "add"
              ? "+"
              : line.type === "remove"
                ? "-"
                : " "}</span
          >
          <span class="line-content">{line.content}</span>
        </div>
        {#if annotationsByEndKey.has(line.key)}
          {#each annotationsByEndKey.get(line.key) ?? [] as ann (ann.id)}
            <div class="annotation-inline">
              <InlineComment
                annotation={toUnitAnnotation(ann)}
                editing={editingId === ann.id}
                onSave={handleSave}
                onCancel={handleCancel}
                onDelete={onRemoveAnnotation}
                onEdit={(id) => (editingId = id)}
              />
            </div>
          {/each}
        {/if}
      {/if}
    {/each}
  </div>
</div>

<style>
  .diff-viewer {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
  }
  .diff-file-header {
    padding: 8px 16px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border);
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .file-path {
    color: var(--color-text-emphasis);
    font-weight: 600;
  }
  .rename-arrow {
    color: var(--color-text-muted);
  }
  .old-path {
    color: var(--color-text-muted);
    text-decoration: line-through;
  }
  .diff-body {
    overflow-x: auto;
  }
  .diff-line {
    display: flex;
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    min-height: 1.5em;
  }
  .line-no {
    width: 48px;
    min-width: 48px;
    padding: 0 8px;
    text-align: right;
    color: var(--color-text-muted);
    user-select: none;
    font-size: 0.75rem;
    opacity: 0.6;
    border-right: 1px solid var(--color-border-muted);
  }
  .plus-gutter {
    width: 28px;
    min-width: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }
  .add-comment-btn {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--color-border);
    background: var(--color-bg-subtle);
    color: var(--color-accent);
    font-size: 12px;
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
      background 0.1s;
  }
  .add-comment-btn.visible {
    opacity: 1;
  }
  .add-comment-btn:hover {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: #fff;
  }
  .add-comment-btn:focus-visible {
    opacity: 1;
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .line-marker {
    width: 1em;
    min-width: 1em;
    text-align: center;
    user-select: none;
  }
  .line-content {
    flex: 1;
    padding-right: 16px;
    white-space: pre;
    min-width: 0;
  }
  .hunk-header {
    background: var(--color-bg-subtle);
    border-top: 1px solid var(--color-border-muted);
    border-bottom: 1px solid var(--color-border-muted);
  }
  .hunk-text {
    color: var(--color-diff-hunk);
    font-style: italic;
    padding: 2px 8px;
  }
  .line-add {
    background: var(--color-diff-add-bg);
  }
  .line-add .line-content,
  .line-add .line-marker {
    color: var(--color-diff-add-text);
  }
  .line-remove {
    background: var(--color-diff-remove-bg);
  }
  .line-remove .line-content,
  .line-remove .line-marker {
    color: var(--color-diff-remove-text);
  }
  .line-context {
    color: var(--color-text-muted);
  }
  .highlighted {
    box-shadow: inset 3px 0 0 var(--color-annotated-border);
  }
  .drag-selected,
  .hovered {
    background: var(--color-annotated-bg) !important;
    box-shadow: inset 3px 0 0 var(--color-accent);
  }
  .annotation-inline {
    margin: 0;
    padding: 0 16px 0 124px; /* align with content after gutters */
    border-top: 1px solid var(--color-border-muted);
    border-bottom: 1px solid var(--color-border-muted);
    background: var(--color-bg-subtle);
  }
</style>
