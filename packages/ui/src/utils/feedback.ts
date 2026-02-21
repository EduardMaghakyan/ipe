import type { Annotation } from "../types";

export function formatFeedback(
  annotations: Annotation[],
  generalComment?: string,
): string {
  const parts: string[] = [];

  if (generalComment?.trim()) {
    parts.push("General feedback:\n");
    parts.push(`> ${generalComment.trim()}\n`);
  }

  if (annotations.length > 0) {
    parts.push("Plan feedback:\n");
    annotations.forEach((annotation, index) => {
      if (annotation.selectedText) {
        const truncated =
          annotation.selectedText.length > 100
            ? annotation.selectedText.slice(0, 100) + "..."
            : annotation.selectedText;
        parts.push(`## ${index + 1}. Feedback on: "${truncated}"`);
      } else {
        parts.push(`## ${index + 1}. Comment on block`);
      }
      parts.push(`> ${annotation.comment}\n`);
    });
  }

  if (parts.length === 0) return "";

  parts.push("---");
  return parts.join("\n");
}
