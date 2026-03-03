export interface AnnotatableUnit {
  id: string;
  type:
    | "heading"
    | "paragraph"
    | "list-item"
    | "code-line"
    | "table-row"
    | "blockquote"
    | "other";
  rawText: string;
  sourceStartLine: number;
  sourceEndLine: number;
}

export interface UnitAnnotation {
  id: string;
  startUnitId: string;
  endUnitId: string;
  selectedText: string;
  comment: string;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  plan: string;
  permissionMode: string;
  previousPlans: PlanVersion[];
  fileSnippets?: FileSnippet[];
  mode?: "plan" | "diff-review";
  fileDiffs?: FileDiff[];
  registeredAt: number;
}

export interface PlanVersion {
  version: number;
  plan: string;
  timestamp: number;
}

export interface FileSnippet {
  path: string;
  startLine?: number;
  endLine?: number;
  content: string;
  error?: string;
}

// Diff review types

export interface DiffHunkLine {
  type: "add" | "remove" | "context";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffHunkLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: "modified" | "added" | "deleted" | "renamed";
  hunks: DiffHunk[];
}

export interface DiffAnnotation {
  id: string;
  filePath: string;
  lineKey: string; // unique key for the diff line (e.g. "hunk-0-line-5")
  startLineKey: string;
  endLineKey: string;
  selectedText: string;
  comment: string;
}
