<script lang="ts">
  interface Props {
    title: string;
    commentCount: number;
    onApprove: () => void;
    onDeny: () => void;
  }

  let { title, commentCount, onApprove, onDeny }: Props = $props();
</script>

<header class="toolbar">
  <div class="toolbar-left">
    <span class="toolbar-title">{title}</span>
    {#if commentCount > 0}
      <span class="badge">{commentCount} comment{commentCount !== 1 ? "s" : ""}</span>
    {/if}
  </div>
  <div class="toolbar-right">
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
    background: #161b22;
    border-bottom: 1px solid #30363d;
  }
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .toolbar-title {
    font-weight: 600;
    font-size: 1rem;
    color: #e6edf3;
  }
  .badge {
    background: #30363d;
    color: #8b949e;
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
    background: #238636;
    color: #fff;
    border-color: #2ea043;
  }
  .btn-approve:hover {
    background: #2ea043;
  }
  .btn-deny {
    background: transparent;
    color: #d29922;
    border-color: #d29922;
  }
  .btn-deny:hover {
    background: rgba(210, 153, 34, 0.1);
  }
</style>
