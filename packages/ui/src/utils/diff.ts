export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function truncateText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
}

export function isDiffContent(lang: string, codeLines: string[]): boolean {
  if (lang === "diff") return true;
  let diffLineCount = 0;
  for (const line of codeLines) {
    if (/^[+-][^+-]/.test(line) || line === "+" || line === "-") {
      diffLineCount++;
    }
  }
  return diffLineCount >= 2;
}

export function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const n = oldLines.length;
  const m = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "context", content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "add", content: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: "remove", content: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

export type CollapsedDiffItem = DiffLine | { type: "fold"; count: number };

export function collapseDiffContext(
  lines: DiffLine[],
  context: number = 10,
): CollapsedDiffItem[] {
  // Find indices of changed lines
  const changed = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== "context") changed.add(i);
  }

  // Mark which lines to keep (within ±context of a change)
  const keep = new Set<number>();
  for (const idx of changed) {
    for (
      let j = Math.max(0, idx - context);
      j <= Math.min(lines.length - 1, idx + context);
      j++
    ) {
      keep.add(j);
    }
  }

  const result: CollapsedDiffItem[] = [];
  let i = 0;
  while (i < lines.length) {
    if (keep.has(i)) {
      result.push(lines[i]);
      i++;
    } else {
      // Count consecutive hidden lines
      let count = 0;
      while (i < lines.length && !keep.has(i)) {
        count++;
        i++;
      }
      result.push({ type: "fold", count });
    }
  }

  return result;
}
