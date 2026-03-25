/** Returns true if the active element is an input, textarea, or contenteditable */
export function isEditableTarget(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
