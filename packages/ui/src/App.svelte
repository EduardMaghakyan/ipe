<script lang="ts">
  import type { Annotation, Block, PlanData } from "./types";
  import { parseMarkdown } from "./utils/parser";
  import { formatFeedback } from "./utils/feedback";
  import Toolbar from "./lib/Toolbar.svelte";
  import PlanViewer from "./lib/PlanViewer.svelte";

  let plan = $state("");
  let blocks = $state<Block[]>([]);
  let annotations = $state<Annotation[]>([]);
  let loading = $state(true);
  let submitting = $state(false);
  let generalComment = $state("");
  let theme = $state<"dark" | "light">(
    (localStorage.getItem("ipe-theme") as "dark" | "light") ?? "dark",
  );

  $effect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ipe-theme", theme);
  });

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
  }

  $effect(() => {
    fetch("/api/plan")
      .then((r) => r.json())
      .then((data: PlanData) => {
        plan = data.plan;
        blocks = parseMarkdown(data.plan);
        loading = false;
      });
  });

  function addAnnotation(annotation: Annotation) {
    annotations = [...annotations, annotation];
  }

  function removeAnnotation(id: string) {
    annotations = annotations.filter((a) => a.id !== id);
  }

  function updateAnnotation(id: string, comment: string) {
    annotations = annotations.map((a) => (a.id === id ? { ...a, comment } : a));
  }

  async function handleApprove() {
    submitting = true;
    const nonEmpty = annotations.filter((a) => a.comment.trim());
    const feedback = formatFeedback(nonEmpty, generalComment);
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
    window.close();
  }

  async function handleDeny() {
    submitting = true;
    const nonEmpty = annotations.filter((a) => a.comment.trim());
    const feedback = formatFeedback(nonEmpty, generalComment);
    await fetch("/api/deny", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
    window.close();
  }

  let title = $derived(() => {
    const firstHeading = blocks.find((b) => b.type === "heading");
    if (firstHeading) return firstHeading.content.replace(/^#+\s*/, "");
    return "Plan Review";
  });
</script>

{#if loading}
  <div class="loading">Loading plan...</div>
{:else if submitting}
  <div class="loading">Submitting... you can close this tab.</div>
{:else}
  <Toolbar
    title={title()}
    commentCount={annotations.length}
    {theme}
    onToggleTheme={toggleTheme}
    onApprove={handleApprove}
    onDeny={handleDeny}
  />
  <main class="main">
    <PlanViewer
      {blocks}
      {annotations}
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
