<script lang="ts">
  import type { FileDiff } from "../types";

  interface Props {
    files: FileDiff[];
    selectedFile: string | null;
    commentCounts: Record<string, number>;
    onSelect: (path: string) => void;
  }

  let { files, selectedFile, commentCounts, onSelect }: Props = $props();

  const statusLabel: Record<string, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
  };

  const statusClass: Record<string, string> = {
    modified: "status-modified",
    added: "status-added",
    deleted: "status-deleted",
    renamed: "status-renamed",
  };

  function filePath(f: FileDiff): string {
    return f.status === "deleted" ? f.oldPath : f.newPath;
  }

  function fileName(path: string): string {
    const parts = path.split("/");
    return parts[parts.length - 1];
  }

  function fileDir(path: string): string {
    const parts = path.split("/");
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/") + "/";
  }

  function lineCounts(f: FileDiff): { add: number; remove: number } {
    let add = 0;
    let remove = 0;
    for (const hunk of f.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") add++;
        else if (line.type === "remove") remove++;
      }
    }
    return { add, remove };
  }
</script>

<div class="file-list">
  <div class="file-list-header">
    Files changed
    <span class="file-count">{files.length}</span>
  </div>
  <div class="file-items">
    {#each files as file (filePath(file))}
      {@const path = filePath(file)}
      {@const counts = lineCounts(file)}
      {@const comments = commentCounts[path] ?? 0}
      <button
        class="file-item"
        class:selected={selectedFile === path}
        onclick={() => onSelect(path)}
      >
        <span class="file-status {statusClass[file.status]}"
          >{statusLabel[file.status]}</span
        >
        <span class="file-name">
          <span class="file-dir">{fileDir(path)}</span>{fileName(path)}
        </span>
        <span class="file-stats">
          {#if counts.add > 0}
            <span class="stat-add">+{counts.add}</span>
          {/if}
          {#if counts.remove > 0}
            <span class="stat-remove">-{counts.remove}</span>
          {/if}
        </span>
        {#if comments > 0}
          <span class="comment-badge">{comments}</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .file-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg-subtle);
    border-right: 1px solid var(--color-border);
  }
  .file-list-header {
    padding: 12px 16px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text-emphasis);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .file-count {
    background: var(--color-bg-overlay);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 0.7rem;
    color: var(--color-text-muted);
  }
  .file-items {
    overflow-y: auto;
    flex: 1;
  }
  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 16px;
    border: none;
    background: transparent;
    color: var(--color-text-default);
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }
  .file-item:hover {
    background: var(--color-bg-overlay);
  }
  .file-item.selected {
    background: var(--color-bg-inset);
    border-left: 2px solid var(--color-accent);
  }
  .file-status {
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 0.7rem;
    font-weight: 700;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .status-modified {
    color: #d29922;
  }
  .status-added {
    color: #3fb950;
  }
  .status-deleted {
    color: #f85149;
  }
  .status-renamed {
    color: #a371f7;
  }
  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 0.75rem;
  }
  .file-dir {
    color: var(--color-text-muted);
  }
  .file-stats {
    display: flex;
    gap: 4px;
    font-size: 0.7rem;
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    flex-shrink: 0;
  }
  .stat-add {
    color: #3fb950;
  }
  .stat-remove {
    color: #f85149;
  }
  .comment-badge {
    background: var(--color-accent);
    color: #fff;
    font-size: 0.65rem;
    padding: 0 5px;
    border-radius: 8px;
    min-width: 16px;
    text-align: center;
    flex-shrink: 0;
  }
</style>
