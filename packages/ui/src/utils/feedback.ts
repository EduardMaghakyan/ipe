import type { Annotation } from "../types";
import { truncateText } from "./diff";

export function formatFeedback(
  annotations: Annotation[],
  generalComment?: string,
): string {
  const parts: string[] = [];

  const trimmedComment = generalComment?.trim();
  if (trimmedComment) {
    parts.push("General feedback:");
    parts.push(`> ${trimmedComment}`);
  }

  if (annotations.length > 0) {
    parts.push("Plan feedback:");
    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      if (ann.selectedText) {
        const truncated = truncateText(ann.selectedText, 100);
        parts.push(`## ${i + 1}. Feedback on: "${truncated}"`);
      } else {
        parts.push(`## ${i + 1}. Comment on block`);
      }
      parts.push(`> ${ann.comment}`);
    }
  }

  if (parts.length === 0) return "";

  parts.push("---");
  return parts.join("\n");
}
