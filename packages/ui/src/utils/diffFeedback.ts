import type { DiffAnnotation } from "../types";
import { truncateText } from "./diff";

export function formatDiffFeedback(
  annotations: DiffAnnotation[],
  generalComment?: string,
): string {
  const parts: string[] = [];

  const trimmedComment = generalComment?.trim();
  if (trimmedComment) {
    parts.push("General feedback:");
    parts.push(`> ${trimmedComment}`);
  }

  if (annotations.length > 0) {
    // Group by file
    const byFile = new Map<string, DiffAnnotation[]>();
    for (const ann of annotations) {
      const list = byFile.get(ann.filePath) ?? [];
      list.push(ann);
      byFile.set(ann.filePath, list);
    }

    let counter = 1;
    for (const [filePath, fileAnns] of byFile) {
      if (parts.length > 0) {
        parts.push("");
      }
      parts.push(`File: ${filePath}`);
      for (const ann of fileAnns) {
        const truncated = truncateText(ann.selectedText, 100);
        parts.push(`## ${counter}. "${truncated}"`);
        parts.push(`> ${ann.comment}`);
        counter++;
      }
    }
  }

  if (parts.length === 0) return "";

  parts.push("---");
  return parts.join("\n");
}
