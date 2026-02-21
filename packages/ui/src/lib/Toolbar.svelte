<script lang="ts">
  interface Props {
    title: string;
    version?: string;
    commentCount: number;
    versionCount: number;
    theme: "dark" | "light";
    onToggleTheme: () => void;
    onCompare: () => void;
    onApprove: () => void;
    onDeny: () => void;
  }

  let {
    title,
    version = "",
    commentCount,
    versionCount,
    theme,
    onToggleTheme,
    onCompare,
    onApprove,
    onDeny,
  }: Props = $props();
</script>

<header class="toolbar">
  <div class="toolbar-left">
    <span class="toolbar-title">{title}</span>
    {#if version && version !== "dev"}
      <span class="version">{version}</span>
    {/if}
    {#if commentCount > 0}
      <span class="badge"
        >{commentCount} comment{commentCount !== 1 ? "s" : ""}</span
      >
    {/if}
  </div>
  <div class="toolbar-right">
    <button
      class="btn btn-secondary"
      onclick={onToggleTheme}
      aria-label="Toggle theme"
    >
      {#if theme === "dark"}
        ☀
      {:else}
        ☾
      {/if}
    </button>
    {#if versionCount > 1}
      <button class="btn btn-secondary" onclick={onCompare}>Compare</button>
    {/if}
    <button class="btn btn-deny" onclick={onDeny}>Request Changes</button>
    <button class="btn btn-approve" onclick={onApprove}>Approve</button>
  </div>
</header>

<style>
  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border);
  }
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .toolbar-title {
    font-weight: 600;
    font-size: 1rem;
    color: var(--color-text-emphasis);
  }
  .version {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    font-weight: 400;
  }
  .badge {
    background: var(--color-border);
    color: var(--color-text-muted);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
  }
  .toolbar-right {
    display: flex;
    gap: 8px;
  }
  .btn {
    padding: 6px 16px;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-approve {
    background: var(--color-approve-bg);
    color: #fff;
    border-color: var(--color-approve-border);
  }
  .btn-approve:hover {
    background: var(--color-approve-hover);
  }
  .btn-deny {
    background: transparent;
    color: var(--color-deny-text);
    border-color: var(--color-deny-text);
  }
  .btn-deny:hover {
    background: var(--color-deny-hover-bg);
  }
  .btn-secondary {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
  }
  .btn-secondary:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-default);
  }
</style>
