<script lang="ts">
  import type { SessionSummary, Question } from "../types";

  interface Props {
    session: SessionSummary;
    sessions: SessionSummary[];
    activeSessionId: string | null;
    theme: "dark" | "light";
    onToggleTheme: () => void;
    onSelectSession: (sessionId: string) => void;
  }

  let { session, sessions, activeSessionId, theme, onToggleTheme, onSelectSession }: Props = $props();

  let questions = $derived(session.questions ?? []);
  let selections = $state<Map<number, Set<number>>>(new Map());
  let otherTexts = $state<Map<number, string>>(new Map());
  let usingOther = $state<Set<number>>(new Set());
  let submitting = $state(false);
  let error = $state("");

  // Initialize selections map for each question
  $effect(() => {
    for (let i = 0; i < questions.length; i++) {
      if (!selections.has(i)) {
        selections.set(i, new Set());
      }
    }
  });

  let allAnswered = $derived.by(() => {
    for (let i = 0; i < questions.length; i++) {
      const sel = selections.get(i);
      const isOther = usingOther.has(i);
      if (isOther) {
        if (!otherTexts.get(i)?.trim()) return false;
      } else {
        if (!sel || sel.size === 0) return false;
      }
    }
    return questions.length > 0;
  });

  function toggleOption(qIndex: number, optIndex: number) {
    const q = questions[qIndex];
    const current = selections.get(qIndex) ?? new Set();

    // Deselect "other" when picking a regular option
    const newUsingOther = new Set(usingOther);
    newUsingOther.delete(qIndex);
    usingOther = newUsingOther;

    if (q.multiSelect) {
      const next = new Set(current);
      if (next.has(optIndex)) next.delete(optIndex);
      else next.add(optIndex);
      selections = new Map(selections).set(qIndex, next);
    } else {
      selections = new Map(selections).set(qIndex, new Set([optIndex]));
    }
  }

  function selectOther(qIndex: number) {
    // Clear option selections for this question
    selections = new Map(selections).set(qIndex, new Set());
    const next = new Set(usingOther);
    next.add(qIndex);
    usingOther = next;
  }

  function formatAnswers(): Record<string, string> {
    const answers: Record<string, string> = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (usingOther.has(i)) {
        answers[q.question] = otherTexts.get(i)?.trim() || "";
      } else {
        const sel = selections.get(i) ?? new Set();
        const labels = Array.from(sel)
          .map((idx) => q.options[idx]?.label)
          .filter(Boolean)
          .join(", ");
        answers[q.question] = labels;
      }
    }
    return answers;
  }

  async function handleSubmit() {
    if (!allAnswered || submitting) return;
    submitting = true;
    error = "";

    const answers = formatAnswers();

    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(session.sessionId)}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        },
      );
      if (!res.ok) {
        error = `Failed to submit: ${res.status}`;
        submitting = false;
      }
    } catch {
      error = "Network error. Please try again.";
      submitting = false;
    }
  }
</script>

<div class="ask-container">
  <header class="ask-header">
    <div class="header-left">
      <span class="header-logo">IPE</span>
      {#if sessions.filter(s => s.mode === "ask").length > 1}
        <div class="session-tabs">
          {#each sessions.filter(s => s.mode === "ask") as s}
            <button
              class="session-tab"
              class:active={s.sessionId === activeSessionId}
              onclick={() => onSelectSession(s.sessionId)}
            >
              {s.questions?.[0]?.header || "Question"}
            </button>
          {/each}
        </div>
      {:else}
        <span class="header-title">Claude needs input</span>
      {/if}
    </div>
    <button class="theme-toggle" onclick={onToggleTheme}>
      {theme === "dark" ? "☀" : "●"}
    </button>
  </header>

  <main class="ask-main">
    {#each questions as q, qIndex}
      <div class="question-card">
        <div class="question-header">
          <span class="question-chip">{q.header}</span>
          {#if q.multiSelect}
            <span class="multi-hint">Select multiple</span>
          {/if}
        </div>
        <p class="question-text">{q.question}</p>

        <div class="options-list">
          {#each q.options as opt, optIndex}
            {@const isSelected =
              !usingOther.has(qIndex) &&
              (selections.get(qIndex)?.has(optIndex) ?? false)}
            <button
              class="option-btn"
              class:selected={isSelected}
              onclick={() => toggleOption(qIndex, optIndex)}
            >
              <span class="option-indicator">
                {#if q.multiSelect}
                  <span class="checkbox" class:checked={isSelected}>
                    {#if isSelected}✓{/if}
                  </span>
                {:else}
                  <span class="radio" class:checked={isSelected}>
                    {#if isSelected}<span class="radio-dot"></span>{/if}
                  </span>
                {/if}
              </span>
              <span class="option-content">
                <span class="option-label">{opt.label}</span>
                <span class="option-desc">{opt.description}</span>
              </span>
            </button>
          {/each}

          <!-- Other option -->
          <button
            class="option-btn"
            class:selected={usingOther.has(qIndex)}
            onclick={() => selectOther(qIndex)}
          >
            <span class="option-indicator">
              {#if q.multiSelect}
                <span class="checkbox" class:checked={usingOther.has(qIndex)}>
                  {#if usingOther.has(qIndex)}✓{/if}
                </span>
              {:else}
                <span class="radio" class:checked={usingOther.has(qIndex)}>
                  {#if usingOther.has(qIndex)}<span class="radio-dot"></span>{/if}
                </span>
              {/if}
            </span>
            <span class="option-content">
              <span class="option-label">Other</span>
              <span class="option-desc">Provide a custom answer</span>
            </span>
          </button>

          {#if usingOther.has(qIndex)}
            <textarea
              class="other-input"
              placeholder="Type your answer..."
              value={otherTexts.get(qIndex) ?? ""}
              oninput={(e) => {
                otherTexts = new Map(otherTexts).set(
                  qIndex,
                  e.currentTarget.value,
                );
              }}
            ></textarea>
          {/if}
        </div>
      </div>
    {/each}

    {#if error}
      <div class="error-msg">{error}</div>
    {/if}

    <button
      class="submit-btn"
      disabled={!allAnswered || submitting}
      onclick={handleSubmit}
    >
      {submitting ? "Submitting..." : "Submit"}
    </button>
  </main>
</div>

<style>
  .ask-container {
    min-height: 100vh;
    background: var(--color-bg-page);
  }

  .ask-header {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--color-bg-subtle);
    border-bottom: 1px solid var(--color-border);
    height: 48px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-logo {
    font-weight: 700;
    font-size: 0.875rem;
    color: var(--color-text-muted);
    letter-spacing: 0.05em;
  }

  .header-title {
    font-size: 0.875rem;
    color: var(--color-text-emphasis);
    font-weight: 500;
  }

  .session-tabs {
    display: flex;
    gap: 4px;
  }

  .session-tab {
    padding: 4px 12px;
    font-size: 0.8rem;
    font-weight: 500;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all 0.15s;
  }

  .session-tab:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-default);
  }

  .session-tab.active {
    background: var(--color-bg-overlay);
    border-color: var(--color-border);
    color: var(--color-text-emphasis);
  }

  .theme-toggle {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .theme-toggle:hover {
    background: var(--color-bg-overlay);
  }

  .ask-main {
    max-width: 640px;
    margin: 0 auto;
    padding: 32px 24px 48px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .question-card {
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 20px;
  }

  .question-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .question-chip {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    background: var(--color-bg-overlay);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .multi-hint {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    font-style: italic;
  }

  .question-text {
    font-size: 1rem;
    color: var(--color-text-emphasis);
    margin-bottom: 16px;
    line-height: 1.5;
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .option-btn {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    padding: 12px;
    background: var(--color-bg-page);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    color: var(--color-text-default);
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .option-btn:hover {
    border-color: var(--color-text-muted);
  }

  .option-btn.selected {
    border-color: var(--color-accent);
    background: var(--color-annotated-bg);
  }

  .option-indicator {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .radio {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--color-border);
    transition: border-color 0.15s;
  }

  .radio.checked {
    border-color: var(--color-accent);
  }

  .radio-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
  }

  .checkbox {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 2px solid var(--color-border);
    font-size: 0.7rem;
    font-weight: 700;
    color: white;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .checkbox.checked {
    border-color: var(--color-accent);
    background: var(--color-accent);
  }

  .option-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .option-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-emphasis);
  }

  .option-desc {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .other-input {
    width: 100%;
    min-height: 60px;
    padding: 10px 12px;
    background: var(--color-bg-page);
    border: 1px solid var(--color-accent);
    border-radius: 8px;
    color: var(--color-text-default);
    font-family: inherit;
    font-size: 0.875rem;
    resize: vertical;
    outline: none;
  }

  .other-input::placeholder {
    color: var(--color-text-muted);
  }

  .error-msg {
    color: var(--color-delete-text);
    font-size: 0.875rem;
    text-align: center;
  }

  .submit-btn {
    align-self: flex-end;
    padding: 8px 24px;
    background: var(--color-approve-bg);
    color: white;
    border: 1px solid var(--color-approve-border);
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.15s,
      opacity 0.15s;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--color-approve-hover);
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
