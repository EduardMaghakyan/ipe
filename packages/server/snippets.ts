import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

export interface FileSnippet {
  path: string;
  startLine?: number;
  endLine?: number;
  content: string;
  error?: string;
}

// Matches backtick-wrapped paths: `src/foo.ts`, `src/foo.ts:42`, `src/foo.ts:10-20`
const FILE_REF_REGEX =
  /`([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+(?::(\d+)(?:-(\d+))?)?)`/g;

const KNOWN_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "html",
  "css",
  "scss",
  "less",
  "svelte",
  "vue",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "md",
  "txt",
  "sh",
  "bash",
  "zsh",
  "sql",
  "graphql",
  "proto",
]);

export function extractFileRefs(markdown: string): Array<{
  path: string;
  startLine?: number;
  endLine?: number;
}> {
  const refs: Array<{ path: string; startLine?: number; endLine?: number }> =
    [];
  const seen = new Set<string>();

  // Skip content inside fenced code blocks
  const withoutCodeBlocks = markdown.replace(/```[\s\S]*?```/g, "");

  for (const match of withoutCodeBlocks.matchAll(FILE_REF_REGEX)) {
    const fullMatch = match[1];
    const pathPart = fullMatch.replace(/:.*$/, "");
    const ext = pathPart.split(".").pop() ?? "";

    if (!KNOWN_EXTENSIONS.has(ext)) continue;

    const key = fullMatch;
    if (seen.has(key)) continue;
    seen.add(key);

    const startLine = match[2] ? parseInt(match[2], 10) : undefined;
    const endLine = match[3] ? parseInt(match[3], 10) : startLine;

    refs.push({ path: pathPart, startLine, endLine });
  }

  return refs;
}

const CONTEXT_LINES = 5;
const MAX_FILE_LINES = 200;
const FILE_READ_TIMEOUT = 5000;

export async function resolveSnippets(
  markdown: string,
  cwd: string,
): Promise<FileSnippet[]> {
  const refs = extractFileRefs(markdown);
  const snippets: FileSnippet[] = [];

  for (const ref of refs) {
    const fullPath = resolve(cwd, ref.path);
    const rel = relative(cwd, fullPath);
    if (rel.startsWith("..")) {
      snippets.push({ path: ref.path, content: "", error: "Path outside project directory" });
      continue;
    }
    try {
      const text = await Promise.race([
        readFile(fullPath, "utf-8"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), FILE_READ_TIMEOUT),
        ),
      ]);
      const lines = text.split("\n");

      if (ref.startLine) {
        const start = Math.max(1, ref.startLine - CONTEXT_LINES);
        const end = Math.min(
          lines.length,
          (ref.endLine ?? ref.startLine) + CONTEXT_LINES,
        );
        snippets.push({
          path: ref.path,
          startLine: start,
          endLine: end,
          content: lines.slice(start - 1, end).join("\n"),
        });
      } else if (lines.length <= MAX_FILE_LINES) {
        snippets.push({
          path: ref.path,
          content: text,
        });
      } else {
        snippets.push({
          path: ref.path,
          content: lines.slice(0, MAX_FILE_LINES).join("\n"),
          error: `File truncated (${lines.length} lines total)`,
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message === "timeout"
          ? "File read timed out"
          : "File not found";
      snippets.push({
        path: ref.path,
        content: "",
        error: msg,
      });
    }
  }

  return snippets;
}
