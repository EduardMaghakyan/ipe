import type { Annotation } from "../types";
import { truncateText } from "./diff";

export function formatFeedback(
  annotations: Annotation[],
  generalComment?: string,
): string {
  const parts: string[] = [];

  const trimmedComment = generalComment?.trim();
  if (trimmedComment) {
    parts.push("General feedback:\n");
    parts.push(`> ${trimmedComment}\n`);
  }

  if (annotations.length > 0) {
    parts.push("Plan feedback:\n");
    annotations.forEach((annotation, index) => {
      if (annotation.selectedText) {
        const truncated = truncateText(annotation.selectedText, 100);
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
