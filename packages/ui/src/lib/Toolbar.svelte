<script lang="ts">
  import type { SessionSummary } from "../types";

  interface Props {
    title: string;
    version?: string;
    latestVersion?: string;
    commentCounts: Record<string, number>;
    versionCount: number;
    theme: "dark" | "light";
    sessions: SessionSummary[];
    activeSessionId: string | null;
    onSelect: (sessionId: string) => void;
    onToggleTheme: () => void;
    onCompare: () => void;
    onApprove: () => void;
    onDeny: () => void;
  }

  let {
    title,
    version = "",
    latestVersion = "",
    commentCounts,
    versionCount,
    theme,
    sessions,
    activeSessionId,
    onSelect,
    onToggleTheme,
    onCompare,
    onApprove,
    onDeny,
  }: Props = $props();

  let multiSession = $derived(sessions.length > 1);

  let upgrading = $state(false);
  let upgradeResult = $state<"success" | "error" | "">("");

  async function handleUpgrade() {
    upgrading = true;
    upgradeResult = "";
    try {
      const res = await fetch("/api/upgrade", { method: "POST" });
      const data = await res.json();
      upgradeResult = data.ok ? "success" : "error";
    } catch {
      upgradeResult = "error";
    } finally {
      upgrading = false;
    }
  }
</script>

<header class="toolbar">
  <div class="toolbar-left" class:tabs-mode={multiSession}>
    {#if multiSession}
      {#each sessions as session (session.sessionId)}
        <button
          class="session-tab"
          class:active={session.sessionId === activeSessionId}
          onclick={() => onSelect(session.sessionId)}
        >
          {session.title}
          {#if commentCounts[session.sessionId] > 0}
            <span class="tab-badge">{commentCounts[session.sessionId]}</span>
          {/if}
        </button>
      {/each}
    {:else}
      <span class="toolbar-title">{title}</span>
      {#if version && version !== "dev"}
        <span class="version">{version}</span>
      {/if}
      {#if activeSessionId && commentCounts[activeSessionId] > 0}
        <span class="badge"
          >{commentCounts[activeSessionId]} comment{commentCounts[
            activeSessionId
          ] !== 1
            ? "s"
            : ""}</span
        >
      {/if}
    {/if}
    {#if latestVersion && latestVersion !== version}
      {#if upgradeResult === "success"}
        <span class="upgrade-success"
          >Updated! Restart IPE to use {latestVersion}</span
        >
      {:else}
        <button
          class="btn-upgrade"
          onclick={handleUpgrade}
          disabled={upgrading}
        >
          {#if upgrading}
            Upgrading...
          {:else}
            Upgrade to {latestVersion}
          {/if}
        </button>
      {/if}
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
    padding: 0 24px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border);
    min-height: 49px;
  }
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 12px 0;
  }
  .toolbar-left.tabs-mode {
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
    gap: 0;
    padding: 0;
    margin-right: 16px;
  }
  .toolbar-left.tabs-mode::-webkit-scrollbar {
    display: none;
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
  .btn-upgrade {
    background: var(--color-accent);
    color: #fff;
    border: none;
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-upgrade:hover {
    background: var(--color-accent-hover);
  }
  .btn-upgrade:disabled {
    opacity: 0.7;
    cursor: wait;
  }
  .upgrade-success {
    font-size: 0.75rem;
    color: var(--color-approve-bg);
    font-weight: 500;
  }
  .badge {
    background: var(--color-border);
    color: var(--color-text-muted);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .tab-badge {
    background: var(--color-border);
    color: var(--color-text-muted);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 0.7rem;
    margin-left: 6px;
    line-height: 1.4;
  }
  .session-tab {
    display: flex;
    align-items: center;
    padding: 14px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    transition:
      color 0.15s,
      border-color 0.15s;
  }
  .session-tab:hover {
    color: var(--color-text-default);
  }
  .session-tab.active {
    color: var(--color-text-emphasis);
    border-bottom-color: var(--color-accent);
  }
  .toolbar-right {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
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
