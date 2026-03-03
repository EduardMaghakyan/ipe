<script lang="ts">
  interface Props {
    generalComment: string;
    activeCommentCount: number;
    submitting: boolean;
    onSubmit: (action: "approve" | "deny", generalComment: string) => void;
    onCommentChange: (comment: string) => void;
    approveLabel?: string;
  }

  let {
    generalComment,
    activeCommentCount,
    submitting,
    onSubmit,
    onCommentChange,
    approveLabel = "Accept plan",
  }: Props = $props();

  let open = $state(false);
  let action = $state<"approve" | "deny">("approve");
  let dropdownEl: HTMLDivElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  function toggle() {
    open = !open;
    if (open) {
      // Set default radio based on comment count when opening
      action = activeCommentCount > 0 ? "deny" : "approve";
      requestAnimationFrame(() => textareaEl?.focus());
    }
  }

  function close() {
    open = false;
  }

  function handleClickOutside(e: MouseEvent) {
    if (dropdownEl && !dropdownEl.contains(e.target as Node)) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      close();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && open) {
      e.preventDefault();
      onSubmit(action, generalComment);
    }
  }

  let inlineCount = $derived(
    activeCommentCount - (generalComment.trim() ? 1 : 0),
  );
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="review-dropdown" bind:this={dropdownEl}>
  <button class="btn-trigger" onclick={toggle} disabled={submitting}>
    Submit review
    {#if activeCommentCount > 0}
      <span class="trigger-badge">{activeCommentCount}</span>
    {/if}
    <span class="caret">▾</span>
  </button>

  {#if open}
    <div class="dropdown-panel">
      <label class="panel-label" for="review-textarea">Leave a comment</label>
      <textarea
        id="review-textarea"
        class="panel-textarea"
        bind:this={textareaEl}
        value={generalComment}
        oninput={(e) => onCommentChange(e.currentTarget.value)}
        placeholder="Leave general feedback about the overall plan..."
      ></textarea>

      {#if inlineCount > 0}
        <div class="inline-note">
          {inlineCount} inline comment{inlineCount !== 1 ? "s" : ""} will be included.
        </div>
      {/if}

      <div class="radio-group">
        <label class="radio-option">
          <input type="radio" bind:group={action} value="approve" />
          <span class="radio-label">{approveLabel}</span>
        </label>
        <label class="radio-option">
          <input type="radio" bind:group={action} value="deny" />
          <span class="radio-label">Request changes</span>
        </label>
      </div>

      <button
        class="btn-submit"
        class:approve={action === "approve"}
        disabled={submitting}
        onclick={() => onSubmit(action, generalComment)}
      >
        {action === "approve" ? approveLabel : "Request changes"}
      </button>
    </div>
  {/if}
</div>

<style>
  .review-dropdown {
    position: relative;
  }
  .btn-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px;
    line-height: 1.6;
    background: var(--color-approve-bg);
    color: #fff;
    border: 1px solid var(--color-approve-border);
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-trigger:hover:not(:disabled) {
    background: var(--color-approve-hover);
  }
  .btn-trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .trigger-badge {
    background: rgba(255, 255, 255, 0.25);
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 0.75rem;
    line-height: 1.4;
  }
  .caret {
    font-size: 0.7rem;
    margin-left: 2px;
  }
  .dropdown-panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 380px;
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 16px;
    z-index: 200;
    box-shadow: 0 8px 24px var(--color-shadow);
  }
  .panel-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-text-emphasis);
    margin-bottom: 8px;
  }
  .panel-textarea {
    width: 100%;
    min-height: 80px;
    padding: 10px 12px;
    background: var(--color-bg-page);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-default);
    font-family: inherit;
    font-size: 0.875rem;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
  }
  .panel-textarea:focus {
    border-color: var(--color-accent);
  }
  .inline-note {
    margin-top: 8px;
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }
  .radio-group {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .radio-option {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .radio-option input[type="radio"] {
    accent-color: var(--color-approve-bg);
    cursor: pointer;
  }
  .radio-label {
    font-size: 0.875rem;
    color: var(--color-text-default);
  }
  .btn-submit {
    margin-top: 14px;
    width: 100%;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
    background: transparent;
    color: var(--color-deny-text);
    border: 1px solid var(--color-deny-text);
  }
  .btn-submit:hover:not(:disabled) {
    background: var(--color-deny-hover-bg);
  }
  .btn-submit.approve {
    background: var(--color-approve-bg);
    color: #fff;
    border-color: var(--color-approve-border);
  }
  .btn-submit.approve:hover:not(:disabled) {
    background: var(--color-approve-hover);
  }
  .btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
