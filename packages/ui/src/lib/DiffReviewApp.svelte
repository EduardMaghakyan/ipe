<script lang="ts">
  import type { FileDiff, DiffAnnotation, SessionSummary } from "../types";
  import { formatDiffFeedback } from "../utils/diffFeedback";
  import FileList from "./FileList.svelte";
  import DiffViewer from "./DiffViewer.svelte";
  import ReviewDropdown from "./ReviewDropdown.svelte";
  import KeyboardShortcutsOverlay from "./KeyboardShortcutsOverlay.svelte";
  import { isEditableTarget } from "../utils/keyboard";

  interface Props {
    session: SessionSummary;
    theme: "dark" | "light";
    onToggleTheme: () => void;
  }

  let { session, theme, onToggleTheme }: Props = $props();

  // svelte-ignore state_referenced_locally
  let fileDiffs = $state<FileDiff[]>(session.fileDiffs ?? []);
  let selectedFile = $state<string | null>(null);
  let diffMode = $state<"unstaged" | "staged" | "all">("unstaged");
  let annotations = $state<DiffAnnotation[]>([]);
  let generalComment = $state("");
  let submitting = $state(false);
  let error = $state("");
  let refreshing = $state(false);
  let hydrated = $state(false);
  let showShortcutsHelp = $state(false);
  let reviewDropdownRef = $state<ReviewDropdown>();

  // Select first file on load
  $effect(() => {
    if (fileDiffs.length > 0 && !selectedFile) {
      selectedFile =
        fileDiffs[0].status === "deleted"
          ? fileDiffs[0].oldPath
          : fileDiffs[0].newPath;
    }
  });

  // Load draft on mount (must run before persistence effect)
  $effect(() => {
    const key = `ipe-diff-draft-${session.sessionId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.annotations) annotations = parsed.annotations;
        if (parsed.generalComment) generalComment = parsed.generalComment;
      } catch {
        // ignore
      }
    }
    hydrated = true;
  });

  // Draft persistence (gated on hydrated to avoid overwriting before load)
  $effect(() => {
    if (!hydrated) return;
    const key = `ipe-diff-draft-${session.sessionId}`;
    localStorage.setItem(key, JSON.stringify({ annotations, generalComment }));
  });

  let selectedFileDiff = $derived(
    fileDiffs.find((f) => {
      const p = f.status === "deleted" ? f.oldPath : f.newPath;
      return p === selectedFile;
    }) ?? null,
  );

  let fileAnnotations = $derived(
    annotations.filter((a) => a.filePath === selectedFile),
  );

  let commentCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const ann of annotations) {
      if (ann.comment.trim()) {
        counts[ann.filePath] = (counts[ann.filePath] ?? 0) + 1;
      }
    }
    return counts;
  });

  let totalCommentCount = $derived(
    annotations.filter((a) => a.comment.trim()).length +
      (generalComment.trim() ? 1 : 0),
  );

  function addAnnotation(a: DiffAnnotation) {
    annotations = [...annotations, a];
  }

  function removeAnnotation(id: string) {
    annotations = annotations.filter((a) => a.id !== id);
  }

  function updateAnnotation(id: string, comment: string) {
    annotations = annotations.map((a) => (a.id === id ? { ...a, comment } : a));
  }

  async function switchDiffMode(mode: "unstaged" | "staged" | "all") {
    if (mode === diffMode || refreshing) return;
    refreshing = true;
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(session.sessionId)}/refresh-diff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.fileDiffs) {
        fileDiffs = data.fileDiffs;
        diffMode = mode;
        // Keep selectedFile if it still exists, otherwise select first
        const paths = fileDiffs.map((f) =>
          f.status === "deleted" ? f.oldPath : f.newPath,
        );
        if (selectedFile && !paths.includes(selectedFile)) {
          selectedFile = paths[0] ?? null;
        }
        // Prune annotations whose line keys no longer exist in the new diffs
        // DiffViewer generates keys as h{hunkIdx}-l{lineIdx} per file
        const validKeysByFile = new Map<string, Set<string>>();
        for (const f of fileDiffs) {
          const fp = f.status === "deleted" ? f.oldPath : f.newPath;
          const keys = new Set<string>();
          for (let hi = 0; hi < f.hunks.length; hi++) {
            for (let li = 0; li < f.hunks[hi].lines.length; li++) {
              keys.add(`h${hi}-l${li}`);
            }
          }
          validKeysByFile.set(fp, keys);
        }
        annotations = annotations.filter((a) => {
          const keys = validKeysByFile.get(a.filePath);
          return keys && keys.has(a.startLineKey) && keys.has(a.endLineKey);
        });
      }
    } catch (err) {
      error = `Failed to refresh diff: ${err}`;
    } finally {
      refreshing = false;
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (
      e.key === "Tab" &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      if (submitting || showShortcutsHelp) return;
      e.preventDefault();
      submitDecision("approve", "auto-approve");
      return;
    }

    if (isEditableTarget()) return;

    if (e.key === "c" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (showShortcutsHelp) return;
      e.preventDefault();
      reviewDropdownRef?.openAndFocusComment();
      return;
    }

    if (e.key === "x" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (submitting || showShortcutsHelp) return;
      e.preventDefault();
      reviewDropdownRef?.openForDeny();
      return;
    }

    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      showShortcutsHelp = !showShortcutsHelp;
      return;
    }
  }

  async function submitDecision(
    action: "approve" | "deny",
    acceptMode?: "normal" | "auto-approve",
  ) {
    if (submitting) return;
    submitting = true;
    const nonEmpty = annotations.filter((a) => a.comment.trim());
    const feedback = formatDiffFeedback(nonEmpty, generalComment);
    const body: Record<string, unknown> = { feedback };
    if (action === "approve" && acceptMode) {
      body.acceptMode = acceptMode;
    }
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(session.sessionId)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        error = `Failed to submit: ${res.status}`;
        submitting = false;
        return;
      }
      localStorage.removeItem(`ipe-diff-draft-${session.sessionId}`);
      window.close();
    } catch {
      error = "Network error. Please try again.";
      submitting = false;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if showShortcutsHelp}
  <KeyboardShortcutsOverlay onClose={() => (showShortcutsHelp = false)} />
{/if}

{#if error}
  <div class="error-banner" role="alert">
    <span>{error}</span>
    <button class="error-dismiss" onclick={() => (error = "")}>Dismiss</button>
  </div>
{/if}

<div class="diff-review-layout">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="toolbar-title">Diff Review</span>
      <div class="diff-mode-toggle">
        <button
          class="mode-btn"
          class:active={diffMode === "unstaged"}
          disabled={refreshing}
          onclick={() => switchDiffMode("unstaged")}>Unstaged</button
        >
        <button
          class="mode-btn"
          class:active={diffMode === "staged"}
          disabled={refreshing}
          onclick={() => switchDiffMode("staged")}>Staged</button
        >
        <button
          class="mode-btn"
          class:active={diffMode === "all"}
          disabled={refreshing}
          onclick={() => switchDiffMode("all")}>All</button
        >
      </div>
      {#if refreshing}
        <span class="refreshing">Refreshing...</span>
      {/if}
    </div>
    <div class="toolbar-right">
      <button
        class="shortcuts-btn"
        onclick={() => (showShortcutsHelp = true)}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts">?</button
      >
      <button class="theme-toggle" onclick={onToggleTheme}>
        {theme === "dark" ? "\u2600" : "\u263E"}
      </button>
      <ReviewDropdown
        bind:this={reviewDropdownRef}
        {generalComment}
        activeCommentCount={totalCommentCount}
        {submitting}
        approveLabel="Approve"
        onCommentChange={(c) => {
          generalComment = c;
        }}
        onSubmit={(action, comment, acceptMode) => {
          generalComment = comment;
          submitDecision(action, acceptMode);
        }}
      />
    </div>
  </div>

  <!-- Main content -->
  <div class="content-panels">
    <!-- File list sidebar -->
    <div class="sidebar">
      <FileList
        files={fileDiffs}
        {selectedFile}
        {commentCounts}
        onSelect={(p) => (selectedFile = p)}
      />
    </div>

    <!-- Diff viewer -->
    <div class="main-area">
      {#if submitting}
        <div class="center-message">Submitting...</div>
      {:else if selectedFileDiff}
        <DiffViewer
          file={selectedFileDiff}
          annotations={fileAnnotations}
          onAddAnnotation={addAnnotation}
          onRemoveAnnotation={removeAnnotation}
          onUpdateAnnotation={updateAnnotation}
        />
      {:else}
        <div class="center-message">Select a file to review</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .diff-review-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    height: 48px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .toolbar-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-text-emphasis);
  }
  .diff-mode-toggle {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    overflow: hidden;
  }
  .mode-btn {
    padding: 3px 10px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 0.75rem;
    cursor: pointer;
  }
  .mode-btn:last-child {
    border-right: none;
  }
  .mode-btn.active {
    color: var(--color-deny-text);
    border: 1px solid var(--color-deny-text);
  }
  .mode-btn:hover:not(.active) {
    background: var(--color-bg-overlay);
  }
  .mode-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .refreshing {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    font-style: italic;
  }
  .shortcuts-btn {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
    padding: 4px 8px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1;
  }
  .shortcuts-btn:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-default);
  }
  .theme-toggle {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
    padding: 4px 8px;
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
  }
  .theme-toggle:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-default);
  }
  .content-panels {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .sidebar {
    width: 280px;
    min-width: 200px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .main-area {
    flex: 1;
    overflow: auto;
    padding: 16px;
  }
  .center-message {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }
  .error-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 101;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--color-delete-hover-bg);
    border-bottom: 1px solid var(--color-delete-text);
    color: var(--color-delete-text);
    font-size: 0.875rem;
  }
  .error-dismiss {
    background: none;
    border: 1px solid var(--color-delete-text);
    border-radius: 4px;
    color: var(--color-delete-text);
    padding: 2px 8px;
    font-size: 0.75rem;
    cursor: pointer;
  }
</style>
