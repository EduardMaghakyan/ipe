<script lang="ts">
  import type { DiffLine } from "../utils/diff";
  import { computeDiff } from "../utils/diff";

  interface PlanVersion {
    version: number;
    plan: string;
    timestamp: number;
  }

  interface SideBySideLine {
    left: { content: string; type: "remove" | "context" | "blank" };
    right: { content: string; type: "add" | "context" | "blank" };
  }

  interface Props {
    currentPlan: string;
    versions: PlanVersion[];
    onClose: () => void;
  }

  let { currentPlan, versions, onClose }: Props = $props();

  let viewMode = $state<"inline" | "side-by-side">("inline");

  // Build allVersions: previous versions + "Current"
  let allVersions = $derived.by(() => {
    const nextVersion =
      versions.length > 0 ? versions[versions.length - 1].version + 1 : 1;
    return [
      ...versions,
      { version: nextVersion, plan: currentPlan, timestamp: Date.now() },
    ];
  });

  let leftIdx = $state(0);
  let rightIdx = $state(0);

  // Default: left = last previous version, right = current
  $effect(() => {
    leftIdx = Math.max(0, allVersions.length - 2);
    rightIdx = allVersions.length - 1;
  });

  let diffLines = $derived.by(() => {
    const oldPlan = allVersions[leftIdx]?.plan ?? "";
    const newPlan = allVersions[rightIdx]?.plan ?? "";
    return computeDiff(oldPlan, newPlan);
  });

  let sideBySideLines = $derived.by(() => {
    const lines: SideBySideLine[] = [];
    for (const line of diffLines) {
      if (line.type === "context") {
        lines.push({
          left: { content: line.content, type: "context" },
          right: { content: line.content, type: "context" },
        });
      } else if (line.type === "remove") {
        lines.push({
          left: { content: line.content, type: "remove" },
          right: { content: "", type: "blank" },
        });
      } else {
        lines.push({
          left: { content: "", type: "blank" },
          right: { content: line.content, type: "add" },
        });
      }
    }
    return lines;
  });

  function formatLabel(v: PlanVersion, idx: number): string {
    return idx === allVersions.length - 1 ? "Current" : `v${v.version}`;
  }

  let leftPanel: HTMLElement | undefined = $state();
  let rightPanel: HTMLElement | undefined = $state();
  let syncing = false;

  function syncScroll(source: HTMLElement, target: HTMLElement | undefined) {
    if (syncing || !target) return;
    syncing = true;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    syncing = false;
  }
</script>

<div class="overlay" role="dialog" aria-label="Plan diff">
  <div class="overlay-header">
    <div class="overlay-controls">
      <select class="version-select" bind:value={leftIdx}>
        {#each allVersions as v, i}
          <option value={i}>{formatLabel(v, i)}</option>
        {/each}
      </select>
      <span class="vs-label">vs</span>
      <select class="version-select" bind:value={rightIdx}>
        {#each allVersions as v, i}
          <option value={i}>{formatLabel(v, i)}</option>
        {/each}
      </select>
      <div class="view-toggle">
        <button
          class="toggle-btn"
          class:active={viewMode === "inline"}
          onclick={() => (viewMode = "inline")}>Inline</button
        >
        <button
          class="toggle-btn"
          class:active={viewMode === "side-by-side"}
          onclick={() => (viewMode = "side-by-side")}>Side-by-side</button
        >
      </div>
    </div>
    <button class="close-btn" onclick={onClose} aria-label="Close diff">
      &times;
    </button>
  </div>

  {#if viewMode === "inline"}
    <div class="diff-content">
      <pre><code
          >{#each diffLines as line}<span
              class="diff-line {line.type === 'add'
                ? 'diff-add'
                : line.type === 'remove'
                  ? 'diff-remove'
                  : 'diff-context'}"
              >{line.type === "add"
                ? "+"
                : line.type === "remove"
                  ? "-"
                  : " "} {line.content}</span
            >
          {/each}</code
        ></pre>
    </div>
  {:else}
    <div class="side-by-side">
      <div
        class="sbs-panel"
        bind:this={leftPanel}
        onscroll={() => syncScroll(leftPanel!, rightPanel)}
      >
        <pre><code
            >{#each sideBySideLines as row}<span
                class="diff-line {row.left.type === 'remove'
                  ? 'diff-remove'
                  : row.left.type === 'blank'
                    ? 'diff-blank'
                    : 'diff-context'}">{row.left.content}</span
              >
            {/each}</code
          ></pre>
      </div>
      <div
        class="sbs-panel"
        bind:this={rightPanel}
        onscroll={() => syncScroll(rightPanel!, leftPanel)}
      >
        <pre><code
            >{#each sideBySideLines as row}<span
                class="diff-line {row.right.type === 'add'
                  ? 'diff-add'
                  : row.right.type === 'blank'
                    ? 'diff-blank'
                    : 'diff-context'}">{row.right.content}</span
              >
            {/each}</code
          ></pre>
      </div>
    </div>
  {/if}
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-page);
  }
  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border);
  }
  .overlay-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--color-text-emphasis);
  }
  .vs-label {
    color: var(--color-text-muted);
    font-weight: 400;
  }
  .version-select {
    padding: 4px 8px;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text-default);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .view-toggle {
    display: flex;
    margin-left: 12px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    overflow: hidden;
  }
  .toggle-btn {
    padding: 4px 10px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 0.75rem;
    cursor: pointer;
  }
  .toggle-btn:last-child {
    border-right: none;
  }
  .toggle-btn.active {
    background: var(--color-bg-overlay);
    color: var(--color-text-emphasis);
  }
  .toggle-btn:hover:not(.active) {
    background: var(--color-bg-overlay);
  }
  .close-btn {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
    font-size: 1.2rem;
    padding: 4px 10px;
    cursor: pointer;
    line-height: 1;
  }
  .close-btn:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-default);
  }
  .diff-content {
    flex: 1;
    overflow: auto;
    padding: 16px 24px;
  }
  .diff-content pre,
  .sbs-panel pre {
    margin: 0;
    font-family:
      "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .diff-line {
    display: inline-block;
    width: 100%;
    padding: 0 8px;
    white-space: pre-wrap;
    min-height: 1.5em;
  }
  .diff-add {
    background: var(--color-diff-add-bg);
    color: var(--color-diff-add-text);
  }
  .diff-remove {
    background: var(--color-diff-remove-bg);
    color: var(--color-diff-remove-text);
  }
  .diff-context {
    color: var(--color-text-muted);
  }
  .diff-blank {
    background: var(--color-bg-inset);
  }
  .side-by-side {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
  .sbs-panel {
    flex: 1;
    overflow: auto;
    padding: 16px 12px;
  }
  .sbs-panel:first-child {
    border-right: 1px solid var(--color-border);
  }
</style>
