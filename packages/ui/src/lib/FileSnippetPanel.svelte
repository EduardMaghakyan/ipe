<script lang="ts">
  import type { FileSnippet } from "../types";
  import { escapeHtml } from "../utils/diff";

  interface Props {
    snippet: FileSnippet;
    x: number;
    y: number;
    onClose: () => void;
  }

  let { snippet, x, y, onClose }: Props = $props();

  let lines = $derived(snippet.content.split("\n"));
  let startNum = $derived(snippet.startLine ?? 1);

  function renderLine(line: string): string {
    return escapeHtml(line) || " ";
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="file-snippet-panel"
  style="left: {x}px; top: {y}px;"
  onclick={(e) => e.stopPropagation()}
>
  <div class="snippet-header">
    <span class="snippet-path">{snippet.path}</span>
    {#if snippet.startLine}
      <span class="snippet-lines">
        :{snippet.startLine}{snippet.endLine && snippet.endLine !== snippet.startLine ? `-${snippet.endLine}` : ""}
      </span>
    {/if}
    {#if snippet.error}
      <span class="snippet-badge">{snippet.error}</span>
    {/if}
    <button class="snippet-close" onclick={onClose} aria-label="Close snippet">&times;</button>
  </div>
  {#if snippet.content}
    <div class="snippet-code">
      <pre><code>{#each lines as line, i}<span class="line-num">{startNum + i}</span><span class="line-content">{@html renderLine(line)}</span>
{/each}</code></pre>
    </div>
  {:else}
    <div class="snippet-empty">{snippet.error || "No content"}</div>
  {/if}
</div>

<style>
  .file-snippet-panel {
    position: fixed;
    z-index: 200;
    width: min(700px, 90vw);
    max-height: 400px;
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 8px 24px var(--color-shadow);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .snippet-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    background: var(--color-bg-overlay);
    border-bottom: 1px solid var(--color-border);
    font-size: 0.8rem;
    min-height: 36px;
  }
  .snippet-path {
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-weight: 600;
    color: var(--color-link);
  }
  .snippet-lines {
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    color: var(--color-text-muted);
  }
  .snippet-badge {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--color-border);
    color: var(--color-text-muted);
    font-size: 0.7rem;
  }
  .snippet-close {
    margin-left: 8px;
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    flex-shrink: 0;
  }
  .snippet-close:hover {
    color: var(--color-text-default);
  }
  .snippet-code {
    overflow: auto;
    flex: 1;
  }
  .snippet-code pre {
    margin: 0;
    padding: 12px 0;
    background: transparent;
    border: none;
    border-radius: 0;
  }
  .snippet-code code {
    font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.8rem;
    line-height: 1.5;
  }
  .snippet-code :global(.line-num) {
    display: inline-block;
    width: 48px;
    text-align: right;
    padding-right: 12px;
    color: var(--color-text-muted);
    user-select: none;
    opacity: 0.6;
  }
  .snippet-code :global(.line-content) {
    white-space: pre;
  }
  .snippet-empty {
    padding: 16px;
    color: var(--color-text-muted);
    font-style: italic;
    font-size: 0.85rem;
  }
</style>
