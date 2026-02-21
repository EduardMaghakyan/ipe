import type { Annotation } from "../types";

export function formatFeedback(annotations: Annotation[]): string {
  if (annotations.length === 0) return "";

  const parts = ["Plan feedback:\n"];

  annotations.forEach((annotation, index) => {
    const truncated =
      annotation.selectedText.length > 100
        ? annotation.selectedText.slice(0, 100) + "..."
        : annotation.selectedText;
    parts.push(`## ${index + 1}. Feedback on: "${truncated}"`);
    parts.push(`> ${annotation.comment}\n`);
  });

  parts.push("---");
  return parts.join("\n");
}
