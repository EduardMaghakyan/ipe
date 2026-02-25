export interface Annotation {
  id: string;
  blockId: string;
  selectedText: string;
  comment: string;
}

export interface LineAnnotation {
  id: string;
  startLine: number;
  endLine: number;
  selectedText: string;
  comment: string;
}

export interface Block {
  id: string;
  type: "heading" | "paragraph" | "code" | "list" | "table" | "blockquote";
  content: string;
  raw: string;
  listStart?: number;
  startLine: number;
  endLine: number;
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
