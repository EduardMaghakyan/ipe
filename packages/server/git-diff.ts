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

export type DiffMode = "unstaged" | "staged" | "all";

export async function runGitDiff(
  cwd: string,
  mode: DiffMode = "unstaged",
): Promise<string> {
  const args = ["diff", "--no-color", "-U3"];
  if (mode === "staged") {
    args.push("--cached");
  } else if (mode === "all") {
    args.push("HEAD");
  }

  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git diff failed (exit ${exitCode}): ${stderr}`);
  }

  return stdout;
}

export function parseUnifiedDiff(raw: string): FileDiff[] {
  if (!raw.trim()) return [];

  const files: FileDiff[] = [];
  // Remove trailing newline to avoid spurious empty context lines
  const lines = raw.replace(/\n$/, "").split("\n");
  let i = 0;

  while (i < lines.length) {
    // Look for "diff --git a/... b/..."
    if (!lines[i].startsWith("diff --git ")) {
      i++;
      continue;
    }

    const diffLine = lines[i];
    const pathMatch = diffLine.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!pathMatch) {
      i++;
      continue;
    }

    let oldPath = pathMatch[1];
    let newPath = pathMatch[2];
    let status: FileDiff["status"] = "modified";
    i++;

    // Parse header lines (old mode, new mode, similarity, rename, index, ---, +++)
    while (i < lines.length && !lines[i].startsWith("diff --git ")) {
      const line = lines[i];

      if (line.startsWith("new file mode")) {
        status = "added";
        i++;
      } else if (line.startsWith("deleted file mode")) {
        status = "deleted";
        i++;
      } else if (line.startsWith("similarity index")) {
        status = "renamed";
        i++;
      } else if (line.startsWith("rename from ")) {
        oldPath = line.slice("rename from ".length);
        i++;
      } else if (line.startsWith("rename to ")) {
        newPath = line.slice("rename to ".length);
        i++;
      } else if (line.startsWith("index ")) {
        i++;
      } else if (line.startsWith("old mode") || line.startsWith("new mode")) {
        i++;
      } else if (line.startsWith("--- ")) {
        i++;
      } else if (line.startsWith("+++ ")) {
        i++;
      } else if (line.startsWith("@@")) {
        // Start of hunks — break out to parse them
        break;
      } else if (line.startsWith("Binary files")) {
        i++;
        break;
      } else {
        i++;
      }
    }

    // Parse hunks
    const hunks: DiffHunk[] = [];

    while (
      i < lines.length &&
      !lines[i].startsWith("diff --git ") &&
      lines[i].startsWith("@@")
    ) {
      const hunkHeader = lines[i];
      const hunkMatch = hunkHeader.match(
        /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
      );
      let oldLineNo = hunkMatch ? parseInt(hunkMatch[1], 10) : 1;
      let newLineNo = hunkMatch ? parseInt(hunkMatch[2], 10) : 1;
      i++;

      const hunkLines: DiffHunkLine[] = [];

      while (
        i < lines.length &&
        !lines[i].startsWith("@@") &&
        !lines[i].startsWith("diff --git ")
      ) {
        const line = lines[i];

        if (line.startsWith("+")) {
          hunkLines.push({
            type: "add",
            content: line.slice(1),
            newLineNo,
          });
          newLineNo++;
        } else if (line.startsWith("-")) {
          hunkLines.push({
            type: "remove",
            content: line.slice(1),
            oldLineNo,
          });
          oldLineNo++;
        } else if (line.startsWith(" ") || line === "") {
          hunkLines.push({
            type: "context",
            content: line.startsWith(" ") ? line.slice(1) : line,
            oldLineNo,
            newLineNo,
          });
          oldLineNo++;
          newLineNo++;
        } else if (line.startsWith("\\")) {
          // "\ No newline at end of file" — skip
          i++;
          continue;
        } else {
          // Unknown line format — likely end of hunk
          break;
        }
        i++;
      }

      hunks.push({ header: hunkHeader, lines: hunkLines });
    }

    files.push({ oldPath, newPath, status, hunks });
  }

  return files;
}
