<script lang="ts">
  import type { Annotation } from "../types";
  import { truncateText } from "../utils/diff";

  interface Props {
    annotation: Annotation;
    editing: boolean;
    onSave: (id: string, comment: string) => void;
    onCancel: (id: string) => void;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
  }

  let { annotation, editing, onSave, onCancel, onDelete, onEdit }: Props =
    $props();
  let draft = $derived(annotation.comment);

  let localDraft = $state("");
  $effect(() => {
    if (editing) localDraft = draft;
  });

  function handleSave() {
    if (localDraft.trim()) {
      onSave(annotation.id, localDraft.trim());
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && e.metaKey) {
      handleSave();
    }
    if (e.key === "Escape") {
      onCancel(annotation.id);
    }
  }
</script>

<div class="inline-comment">
  {#if annotation.selectedText}
    <div class="quoted-text">
      {truncateText(annotation.selectedText, 120)}
    </div>
  {/if}
  {#if editing}
    <textarea
      class="comment-input"
      bind:value={localDraft}
      onkeydown={handleKeydown}
      placeholder="Write a comment... (⌘+Enter to save)"
    ></textarea>
    <div class="comment-actions">
      <button class="action-btn cancel" onclick={() => onCancel(annotation.id)}
        >Cancel</button
      >
      <button
        class="action-btn save"
        onclick={handleSave}
        disabled={!localDraft.trim()}>Save</button
      >
    </div>
  {:else}
    <div class="comment-body">
      {annotation.comment}
    </div>
    <div class="comment-actions">
      <button class="action-btn edit" onclick={() => onEdit(annotation.id)}
        >Edit</button
      >
      <button class="action-btn delete" onclick={() => onDelete(annotation.id)}
        >Delete</button
      >
    </div>
  {/if}
</div>

<style>
  .inline-comment {
    margin: 8px 0 16px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg-subtle);
    overflow: hidden;
  }
  .quoted-text {
    padding: 8px 12px;
    background: var(--color-bg-inset);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 0.8rem;
    font-style: italic;
    white-space: pre-wrap;
  }
  .comment-input {
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
  .comment-body {
    padding: 12px;
    font-size: 0.875rem;
    white-space: pre-wrap;
    color: var(--color-text-default);
  }
  .comment-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--color-border);
  }
  .action-btn {
    padding: 4px 12px;
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .save {
    background: var(--color-approve-bg);
    color: #fff;
  }
  .save:hover:not(:disabled) {
    background: var(--color-approve-hover);
  }
  .save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cancel {
    background: transparent;
    color: var(--color-text-muted);
    border-color: var(--color-border);
  }
  .cancel:hover {
    background: var(--color-bg-overlay);
  }
  .edit {
    background: transparent;
    color: var(--color-text-muted);
    border-color: var(--color-border);
  }
  .edit:hover {
    background: var(--color-bg-overlay);
  }
  .delete {
    background: transparent;
    color: var(--color-delete-text);
    border-color: var(--color-delete-text);
  }
  .delete:hover {
    background: var(--color-delete-hover-bg);
  }
</style>
