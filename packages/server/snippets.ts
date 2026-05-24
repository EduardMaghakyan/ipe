import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

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
const RESOLVE_BUDGET_MS = 5_000;
const PER_FILE_TIMEOUT_MS = 1_000;

export async function resolveSnippets(
  markdown: string,
  cwd: string,
): Promise<FileSnippet[]> {
  const refs = extractFileRefs(markdown);
  const snippets: FileSnippet[] = [];
  const deadline = Date.now() + RESOLVE_BUDGET_MS;
  const realCwd = await realpath(cwd);

  for (const ref of refs) {
    const remaining = deadline - Date.now();
    // Skip the read attempt entirely when the remaining budget is too small
    // to do useful work — otherwise we'd burn it on a 0–50ms timer that
    // fires before the readFile can complete and report a misleading
    // "File read timed out" instead of "budget exceeded".
    if (remaining < 50) {
      snippets.push({
        path: ref.path,
        content: "",
        error: "Snippet resolution budget exceeded",
      });
      continue;
    }

    const fullPath = resolve(cwd, ref.path);

    let realFullPath: string;
    try {
      realFullPath = await realpath(fullPath);
      if (!realFullPath.startsWith(realCwd + "/")) {
        snippets.push({
          path: ref.path,
          content: "",
          error: "Path outside project directory",
        });
        continue;
      }
    } catch {
      snippets.push({ path: ref.path, content: "", error: "File not found" });
      continue;
    }

    const fileTimeout = Math.min(remaining, PER_FILE_TIMEOUT_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const text = await Promise.race([
        readFile(realFullPath, "utf-8"),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), fileTimeout);
        }),
      ]);
      clearTimeout(timer);
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
      } else {
        snippets.push({
          path: ref.path,
          content: text,
        });
      }
    } catch (err) {
      clearTimeout(timer);
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
