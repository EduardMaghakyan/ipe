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
