<script lang="ts">
  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose} onkeydown={() => {}}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="card"
    role="dialog"
    tabindex="-1"
    aria-label="Keyboard shortcuts"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="header">
      <h2>Keyboard Shortcuts</h2>
      <button class="close-btn" onclick={onClose} aria-label="Close"
        >&times;</button
      >
    </div>
    <table>
      <tbody>
        <tr>
          <td class="key"><kbd>Shift</kbd> + <kbd>Tab</kbd></td>
          <td>Accept plan, auto-approve edits</td>
        </tr>
        <tr>
          <td class="key"><kbd>x</kbd></td>
          <td>Request changes</td>
        </tr>
        <tr>
          <td class="key"><kbd>c</kbd></td>
          <td>Open review panel / comment</td>
        </tr>
        <tr>
          <td class="key"
            ><kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}</kbd> +
            <kbd>Enter</kbd></td
          >
          <td>Submit review / save comment</td>
        </tr>
        <tr>
          <td class="key"><kbd>Escape</kbd></td>
          <td>Close overlay / cancel</td>
        </tr>
        <tr>
          <td class="key"><kbd>?</kbd></td>
          <td>Show this help</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 400;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card {
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 24px;
    min-width: 340px;
    max-width: 440px;
    box-shadow: 0 12px 40px var(--color-shadow);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  h2 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-emphasis);
    margin: 0;
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 1.4rem;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }
  .close-btn:hover {
    color: var(--color-text-default);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  tr {
    border-bottom: 1px solid var(--color-border-muted);
  }
  tr:last-child {
    border-bottom: none;
  }
  td {
    padding: 8px 0;
    font-size: 0.875rem;
    color: var(--color-text-default);
  }
  td.key {
    white-space: nowrap;
    padding-right: 24px;
    color: var(--color-text-muted);
  }
  kbd {
    display: inline-block;
    padding: 2px 6px;
    background: var(--color-bg-page);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.8rem;
    color: var(--color-text-emphasis);
    line-height: 1.4;
  }
</style>
