export interface Annotation {
  id: string;
  blockId: string;
  selectedText: string;
  comment: string;
}

export interface Block {
  id: string;
  type: "heading" | "paragraph" | "code" | "list" | "table" | "blockquote";
  content: string;
  raw: string;
}

export interface PlanData {
  plan: string;
  permissionMode: string;
}

export interface PlanVersion {
  version: number;
  plan: string;
  timestamp: number;
}
