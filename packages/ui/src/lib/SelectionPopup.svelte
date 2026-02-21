<script lang="ts">
  interface Props {
    x: number;
    y: number;
    onAddComment: () => void;
  }

  let { x, y, onAddComment }: Props = $props();
</script>

<div class="popup" style="left: {x}px; top: {y}px;">
  <button class="popup-btn" onclick={onAddComment}>+ Add Comment</button>
</div>

<style>
  .popup {
    position: fixed;
    z-index: 200;
    transform: translate(-50%, -100%);
    margin-top: -8px;
  }
  .popup-btn {
    background: #1f6feb;
    color: #fff;
    border: none;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .popup-btn:hover {
    background: #388bfd;
  }
</style>
