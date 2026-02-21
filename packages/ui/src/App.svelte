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
    const feedback = formatFeedback(annotations);
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
  }

  async function handleDeny() {
    submitting = true;
    const feedback = formatFeedback(annotations);
    await fetch("/api/deny", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
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
  </main>
{/if}

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    line-height: 1.6;
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-size: 1.1rem;
    color: #8b949e;
  }
  .main {
    max-width: 860px;
    margin: 0 auto;
    padding: 80px 24px 48px;
  }
</style>
