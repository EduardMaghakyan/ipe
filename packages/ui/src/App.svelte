<script lang="ts">
  import { onMount } from "svelte";
  import type {
    LineAnnotation,
    Block,
    PlanVersion,
    SessionSummary,
  } from "./types";
  import { parseMarkdown, blocksToLines } from "./utils/parser";
  import { formatFeedback } from "./utils/feedback";
  import { computeDiff, collapseDiffContext } from "./utils/diff";
  import type { CollapsedDiffItem } from "./utils/diff";
  import Toolbar from "./lib/Toolbar.svelte";
  import PlanViewer from "./lib/PlanViewer.svelte";
  import DiffOverlay from "./lib/DiffOverlay.svelte";

  interface SessionUIState {
    annotations: LineAnnotation[];
    generalComment: string;
    blocks: Block[];
  }

  let sessions = $state<SessionSummary[]>([]);
  let activeSessionId = $state<string | null>(null);
  // Store per-session UI state, keyed by sessionId
  const sessionUIStates = new Map<string, SessionUIState>();

  // Active session's direct state (for reactivity — same pattern as original code)
  let blocks = $state<Block[]>([]);
  let annotations = $state<LineAnnotation[]>([]);
  let generalComment = $state("");

  let version = $state("");
  let latestVersion = $state("");
  let showDiff = $state(false);
  let diffOnly = $state(false);
  let loading = $state(true);
  let loadError = $state("");
  let error = $state("");
  let submitting = $state(false);
  let theme = $state<"dark" | "light">(
    (localStorage.getItem("ipe-theme") as "dark" | "light") ?? "dark",
  );

  $effect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ipe-theme", theme);
  });

  $effect(() => {
    if (activeSessionId) {
      saveDraft(activeSessionId, annotations, generalComment);
    }
  });

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
  }

  function saveDraft(
    sessionId: string,
    ann: LineAnnotation[],
    comment: string,
  ) {
    localStorage.setItem(
      `ipe-draft-${sessionId}`,
      JSON.stringify({ annotations: ann, generalComment: comment }),
    );
  }

  function loadDraft(
    sessionId: string,
  ): { annotations: LineAnnotation[]; generalComment: string } | null {
    const raw = localStorage.getItem(`ipe-draft-${sessionId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearDraft(sessionId: string) {
    localStorage.removeItem(`ipe-draft-${sessionId}`);
  }

  function saveActiveState() {
    if (activeSessionId) {
      const state = sessionUIStates.get(activeSessionId);
      if (state) {
        state.annotations = annotations;
        state.generalComment = generalComment;
        state.blocks = blocks;
      }
      saveDraft(activeSessionId, annotations, generalComment);
    }
  }

  function loadSessionState(sessionId: string) {
    const state = sessionUIStates.get(sessionId);
    if (state) {
      blocks = state.blocks;
      annotations = state.annotations;
      generalComment = state.generalComment;
    }
  }

  function switchSession(sessionId: string) {
    if (sessionId === activeSessionId) return;
    saveActiveState();
    activeSessionId = sessionId;
    loadSessionState(sessionId);
    showDiff = false;
  }

  function addSessionToUI(s: SessionSummary) {
    const saved = loadDraft(s.sessionId);
    sessions = [...sessions, s];
    sessionUIStates.set(s.sessionId, {
      annotations: saved?.annotations ?? [],
      generalComment: saved?.generalComment ?? "",
      blocks: parseMarkdown(s.plan),
    });
    // Auto-select first session
    if (!activeSessionId) {
      activeSessionId = s.sessionId;
      loadSessionState(s.sessionId);
    }
  }

  function removeSessionFromUI(sessionId: string) {
    if (!sessions.find((s) => s.sessionId === sessionId)) return;
    sessions = sessions.filter((s) => s.sessionId !== sessionId);
    sessionUIStates.delete(sessionId);
    clearDraft(sessionId);
    submitting = false;
    if (activeSessionId === sessionId) {
      if (sessions.length > 0) {
        activeSessionId = sessions[0].sessionId;
        loadSessionState(activeSessionId);
      } else {
        activeSessionId = null;
        blocks = [];
        annotations = [];
        generalComment = "";
        window.close();
      }
    }
  }

  onMount(() => {
    let es: EventSource | undefined;

    // Fetch version info from health endpoint
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: { version?: string; latestVersion?: string }) => {
        version = data.version || "";
        latestVersion = data.latestVersion || "";
      })
      .catch(() => {});

    fetch("/api/sessions")
      .then((r) => r.json())
      .then((list: SessionSummary[]) => {
        for (const s of list) {
          addSessionToUI(s);
        }
        loading = false;

        // Connect SSE for real-time updates
        es = new EventSource("/api/events");
        es.addEventListener("session-added", (e) => {
          const s = JSON.parse(e.data) as SessionSummary;
          if (!sessions.find((x) => x.sessionId === s.sessionId)) {
            addSessionToUI(s);
          }
        });
        es.addEventListener("session-removed", (e) => {
          const { sessionId } = JSON.parse(e.data) as { sessionId: string };
          removeSessionFromUI(sessionId);
        });
      })
      .catch(() => {
        loadError = "Failed to load sessions. Please refresh.";
        loading = false;
      });

    return () => {
      es?.close();
    };
  });

  let activeSession = $derived(
    sessions.find((s) => s.sessionId === activeSessionId) ?? null,
  );
  let versions = $derived(activeSession?.previousPlans ?? []);

  let snippetPaths = $derived.by(() => {
    const paths = new Set<string>();
    for (const s of activeSession?.fileSnippets ?? []) {
      paths.add(s.path);
    }
    return paths;
  });

  let lines = $derived(blocksToLines(blocks, snippetPaths));

  let inlineDiffLines = $derived.by<CollapsedDiffItem[] | null>(() => {
    if (!diffOnly || !activeSession) return null;
    const prevPlans = activeSession.previousPlans ?? [];
    if (prevPlans.length === 0) return null;
    const previousPlan = prevPlans[prevPlans.length - 1].plan;
    const raw = computeDiff(previousPlan, activeSession.plan);
    return collapseDiffContext(raw);
  });

  let title = $derived.by(() => {
    const firstHeading = blocks.find((b) => b.type === "heading");
    if (firstHeading) return firstHeading.content.replace(/^#+\s*/, "");
    return "Plan Review";
  });

  let commentCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const s of sessions) {
      if (s.sessionId === activeSessionId) {
        counts[s.sessionId] = annotations.length;
      } else {
        counts[s.sessionId] =
          sessionUIStates.get(s.sessionId)?.annotations.length ?? 0;
      }
    }
    return counts;
  });

  let activeCommentCount = $derived(
    annotations.filter((a) => a.comment.trim()).length,
  );

  function addAnnotation(annotation: LineAnnotation) {
    annotations = [...annotations, annotation];
  }

  function removeAnnotation(id: string) {
    annotations = annotations.filter((a) => a.id !== id);
  }

  function updateAnnotation(id: string, comment: string) {
    annotations = annotations.map((a) => (a.id === id ? { ...a, comment } : a));
  }

  async function submitDecision(action: "approve" | "deny") {
    if (!activeSessionId || submitting) return;
    submitting = true;
    const sid = activeSessionId;
    const nonEmpty = annotations.filter((a) => a.comment.trim());
    const feedback = formatFeedback(nonEmpty, generalComment);
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sid)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback }),
        },
      );
      if (!res.ok) {
        error = `Failed to submit: ${res.status}`;
        submitting = false;
        return;
      }
      clearDraft(sid);
      removeSessionFromUI(sid);
    } catch {
      error = "Network error. Please try again.";
      submitting = false;
    }
  }
</script>

{#if loading}
  <div class="loading">Loading plan...</div>
{:else if loadError}
  <div class="loading">{loadError}</div>
{:else if submitting}
  <div class="loading">Submitting...</div>
{:else if !activeSession}
  <div class="loading">No pending plans.</div>
{:else}
  {#if error}
    <div class="error-banner" role="alert">
      <span>{error}</span>
      <button class="error-dismiss" onclick={() => (error = "")}>Dismiss</button
      >
    </div>
  {/if}
  {#if showDiff}
    <DiffOverlay
      currentPlan={activeSession.plan}
      {versions}
      onClose={() => (showDiff = false)}
    />
  {/if}
  <Toolbar
    {title}
    {version}
    {latestVersion}
    {commentCounts}
    {activeCommentCount}
    versionCount={versions.length + 1}
    {theme}
    {submitting}
    {sessions}
    {activeSessionId}
    onSelect={switchSession}
    onToggleTheme={toggleTheme}
    onCompare={() => (showDiff = true)}
    {diffOnly}
    onToggleDiffOnly={() => (diffOnly = !diffOnly)}
    onApprove={() => submitDecision("approve")}
    onDeny={() => submitDecision("deny")}
  />
  <main class="main">
    <PlanViewer
      {lines}
      {annotations}
      fileSnippets={activeSession?.fileSnippets}
      diffLines={inlineDiffLines}
      {theme}
      onAddAnnotation={addAnnotation}
      onRemoveAnnotation={removeAnnotation}
      onUpdateAnnotation={updateAnnotation}
    />
    <div class="general-comment">
      <div class="general-comment-header">General feedback</div>
      <textarea
        class="general-comment-input"
        bind:value={generalComment}
        placeholder="Leave general feedback about the overall plan..."
      ></textarea>
    </div>
  </main>
{/if}

<style>
  :global(:root) {
    --color-bg-page: #0d1117;
    --color-bg-subtle: #161b22;
    --color-bg-inset: #1c2128;
    --color-bg-overlay: #21262d;
    --color-border: #30363d;
    --color-border-muted: #21262d;
    --color-text-default: #c9d1d9;
    --color-text-emphasis: #e6edf3;
    --color-text-muted: #8b949e;
    --color-link: #58a6ff;
    --color-accent: #1f6feb;
    --color-accent-hover: #388bfd;
    --color-approve-bg: #238636;
    --color-approve-border: #2ea043;
    --color-approve-hover: #2ea043;
    --color-deny-text: #e4e4df;
    --color-deny-hover-bg: rgba(27, 26, 25, 0.1);
    --color-delete-text: #f85149;
    --color-delete-hover-bg: rgba(248, 81, 73, 0.1);
    --color-annotated-border: #1f6feb;
    --color-annotated-bg: rgba(31, 111, 235, 0.05);
    --color-diff-add-bg: rgba(35, 134, 54, 0.2);
    --color-diff-add-text: #7ee787;
    --color-diff-remove-bg: rgba(248, 81, 73, 0.2);
    --color-diff-remove-text: #ffa198;
    --color-diff-hunk: #bc8cff;
    --color-shadow: rgba(0, 0, 0, 0.4);
  }

  :global([data-theme="light"]) {
    --color-bg-page: #ffffff;
    --color-bg-subtle: #f6f8fa;
    --color-bg-inset: #f6f8fa;
    --color-bg-overlay: #eaeef2;
    --color-border: #d0d7de;
    --color-border-muted: #d0d7de;
    --color-text-default: #1f2328;
    --color-text-emphasis: #1f2328;
    --color-text-muted: #656d76;
    --color-link: #0969da;
    --color-accent: #0969da;
    --color-accent-hover: #0550ae;
    --color-approve-bg: #1a7f37;
    --color-approve-border: #1a7f37;
    --color-approve-hover: #2da44e;
    --color-deny-text: #141413;
    --color-deny-hover-bg: rgba(27, 26, 25, 0.1);
    --color-delete-text: #cf222e;
    --color-delete-hover-bg: rgba(207, 34, 46, 0.1);
    --color-annotated-border: #0969da;
    --color-annotated-bg: rgba(9, 105, 218, 0.05);
    --color-diff-add-bg: rgba(26, 127, 55, 0.15);
    --color-diff-add-text: #116329;
    --color-diff-remove-bg: rgba(207, 34, 46, 0.15);
    --color-diff-remove-text: #82071e;
    --color-diff-hunk: #6639ba;
    --color-shadow: rgba(0, 0, 0, 0.15);
  }

  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  :global(body) {
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu,
      sans-serif;
    background: var(--color-bg-page);
    color: var(--color-text-default);
    line-height: 1.6;
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-size: 1.1rem;
    color: var(--color-text-muted);
  }
  .error-banner {
    position: fixed;
    top: 49px;
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
  .main {
    max-width: 860px;
    margin: 0 auto;
    padding: 80px 24px 48px;
  }
  .general-comment {
    margin-top: 32px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
  }
  .general-comment-header {
    padding: 8px 12px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-text-muted);
  }
  .general-comment-input {
    width: 100%;
    min-height: 80px;
    padding: 12px;
    background: transparent;
    border: none;
    color: var(--color-text-default);
    font-family: inherit;
    font-size: 0.875rem;
    resize: vertical;
    outline: none;
  }
</style>
