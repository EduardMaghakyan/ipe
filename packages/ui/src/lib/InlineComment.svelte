<script lang="ts">
  import type { Annotation } from "../types";

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
  <div class="quoted-text">
    {annotation.selectedText.length > 120
      ? annotation.selectedText.slice(0, 120) + "..."
      : annotation.selectedText}
  </div>
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
      <button class="action-btn save" onclick={handleSave}>Save</button>
    </div>
  {:else}
    <button
      type="button"
      class="comment-body"
      onclick={() => onEdit(annotation.id)}
    >
      {annotation.comment}
    </button>
    <div class="comment-actions">
      <button class="action-btn delete" onclick={() => onDelete(annotation.id)}
        >Delete</button
      >
    </div>
  {/if}
</div>

<style>
  .inline-comment {
    margin: 8px 0 16px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #161b22;
    overflow: hidden;
  }
  .quoted-text {
    padding: 8px 12px;
    background: #1c2128;
    border-bottom: 1px solid #30363d;
    color: #8b949e;
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
    color: #c9d1d9;
    font-family: inherit;
    font-size: 0.875rem;
    resize: vertical;
    outline: none;
  }
  .comment-body {
    padding: 12px;
    font-size: 0.875rem;
    cursor: pointer;
    white-space: pre-wrap;
  }
  .comment-body:hover {
    background: #1c2128;
  }
  .comment-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid #30363d;
  }
  .action-btn {
    padding: 4px 12px;
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .save {
    background: #238636;
    color: #fff;
  }
  .save:hover {
    background: #2ea043;
  }
  .cancel {
    background: transparent;
    color: #8b949e;
    border-color: #30363d;
  }
  .cancel:hover {
    background: #21262d;
  }
  .delete {
    background: transparent;
    color: #f85149;
    border-color: #f85149;
  }
  .delete:hover {
    background: rgba(248, 81, 73, 0.1);
  }
</style>
