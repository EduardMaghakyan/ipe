import { describe, test, expect, afterAll } from "bun:test";
import { parseUnifiedDiff, runGitDiff } from "../../packages/server/git-diff";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseUnifiedDiff", () => {
  test("returns empty array for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("  \n  ")).toEqual([]);
  });

  test("parses a simple modified file", () => {
    const diff = `diff --git a/src/main.ts b/src/main.ts
index abc1234..def5678 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,5 +1,6 @@
 import { foo } from './foo';
-import { bar } from './bar';
+import { bar } from './baz';
+import { qux } from './qux';

 function main() {
   console.log('hello');
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].oldPath).toBe("src/main.ts");
    expect(result[0].newPath).toBe("src/main.ts");
    expect(result[0].status).toBe("modified");
    expect(result[0].hunks).toHaveLength(1);

    const lines = result[0].hunks[0].lines;
    expect(lines[0]).toEqual({
      type: "context",
      content: "import { foo } from './foo';",
      oldLineNo: 1,
      newLineNo: 1,
    });
    expect(lines[1]).toEqual({
      type: "remove",
      content: "import { bar } from './bar';",
      oldLineNo: 2,
    });
    expect(lines[2]).toEqual({
      type: "add",
      content: "import { bar } from './baz';",
      newLineNo: 2,
    });
    expect(lines[3]).toEqual({
      type: "add",
      content: "import { qux } from './qux';",
      newLineNo: 3,
    });
  });

  test("parses a new file", () => {
    const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  return 'world';
+}
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("added");
    expect(result[0].hunks[0].lines).toHaveLength(3);
    expect(result[0].hunks[0].lines[0].type).toBe("add");
  });

  test("parses a deleted file", () => {
    const diff = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function old() {
-  return 'gone';
-}
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("deleted");
    expect(result[0].hunks[0].lines).toHaveLength(3);
    expect(result[0].hunks[0].lines[0].type).toBe("remove");
  });

  test("parses a renamed file", () => {
    const diff = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 90%
rename from src/old-name.ts
rename to src/new-name.ts
index abc1234..def5678 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 export function hello() {
-  return 'old';
+  return 'new';
 }
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("renamed");
    expect(result[0].oldPath).toBe("src/old-name.ts");
    expect(result[0].newPath).toBe("src/new-name.ts");
  });

  test("parses multiple files", () => {
    const diff = `diff --git a/a.ts b/a.ts
index abc..def 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;
 export default x;
diff --git a/b.ts b/b.ts
index ghi..jkl 100644
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,2 @@
-const y = 1;
+const y = 2;
 export default y;
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(2);
    expect(result[0].newPath).toBe("a.ts");
    expect(result[1].newPath).toBe("b.ts");
  });

  test("parses multiple hunks in one file", () => {
    const diff = `diff --git a/big.ts b/big.ts
index abc..def 100644
--- a/big.ts
+++ b/big.ts
@@ -5,3 +5,3 @@ // top
 function a() {
-  return 1;
+  return 2;
 }
@@ -20,3 +20,3 @@ // middle
 function b() {
-  return 3;
+  return 4;
 }
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].hunks[0].header).toContain("@@ -5,3 +5,3 @@");
    expect(result[0].hunks[1].header).toContain("@@ -20,3 +20,3 @@");
  });

  test("tracks line numbers correctly", () => {
    const diff = `diff --git a/f.ts b/f.ts
index abc..def 100644
--- a/f.ts
+++ b/f.ts
@@ -10,4 +10,5 @@
 line10
-line11old
+line11new
+line11b
 line12
 line13
`;

    const result = parseUnifiedDiff(diff);
    const lines = result[0].hunks[0].lines;
    // context: both line numbers
    expect(lines[0].oldLineNo).toBe(10);
    expect(lines[0].newLineNo).toBe(10);
    // remove: only old
    expect(lines[1].oldLineNo).toBe(11);
    expect(lines[1].newLineNo).toBeUndefined();
    // add: only new
    expect(lines[2].newLineNo).toBe(11);
    expect(lines[2].oldLineNo).toBeUndefined();
    expect(lines[3].newLineNo).toBe(12);
    // context after: both incremented correctly
    expect(lines[4].oldLineNo).toBe(12);
    expect(lines[4].newLineNo).toBe(13);
  });

  test("handles binary file diff", () => {
    const diff = `diff --git a/image.png b/image.png
index abc1234..def5678 100644
Binary files a/image.png and b/image.png differ
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].newPath).toBe("image.png");
    expect(result[0].status).toBe("modified");
    expect(result[0].hunks).toHaveLength(0);
  });

  test("skips 'No newline at end of file' marker", () => {
    const diff = `diff --git a/f.ts b/f.ts
index abc..def 100644
--- a/f.ts
+++ b/f.ts
@@ -1,2 +1,2 @@
-old line
\\ No newline at end of file
+new line
\\ No newline at end of file
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    const lines = result[0].hunks[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      type: "remove",
      content: "old line",
      oldLineNo: 1,
    });
    expect(lines[1]).toEqual({
      type: "add",
      content: "new line",
      newLineNo: 1,
    });
  });

  test("handles file mode change lines", () => {
    const diff = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
index abc..def
--- a/script.sh
+++ b/script.sh
@@ -1,2 +1,2 @@
-echo old
+echo new
 done
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("modified");
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].lines).toHaveLength(3);
  });

  test("handles rename with no hunks", () => {
    const diff = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`;

    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("renamed");
    expect(result[0].oldPath).toBe("old.ts");
    expect(result[0].newPath).toBe("new.ts");
    expect(result[0].hunks).toHaveLength(0);
  });
});

describe("runGitDiff", () => {
  async function initRepo(dir: string) {
    mkdirSync(dir, { recursive: true });
    const run = (cmd: string[]) =>
      Bun.spawn(cmd, { cwd: dir, stdout: "pipe", stderr: "pipe" });
    await run(["git", "init"]).exited;
    await run(["git", "config", "user.email", "test@test.com"]).exited;
    await run(["git", "config", "user.name", "Test"]).exited;
    writeFileSync(join(dir, "file.txt"), "original\n");
    await run(["git", "add", "."]).exited;
    await run(["git", "commit", "-m", "init"]).exited;
    return run;
  }

  test("returns unstaged diff", async () => {
    const dir = join(tmpdir(), `ipe-git-diff-unstaged-${Date.now()}`);
    try {
      await initRepo(dir);
      writeFileSync(join(dir, "file.txt"), "modified\n");

      const result = await runGitDiff(dir, "unstaged");
      expect(result).toContain("file.txt");
      expect(result).toContain("-original");
      expect(result).toContain("+modified");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch {}
    }
  });

  test("returns staged diff", async () => {
    const dir = join(tmpdir(), `ipe-git-diff-staged-${Date.now()}`);
    try {
      const run = await initRepo(dir);
      writeFileSync(join(dir, "file.txt"), "modified\n");
      await run(["git", "add", "."]).exited;

      const unstaged = await runGitDiff(dir, "unstaged");
      expect(unstaged.trim()).toBe("");

      const staged = await runGitDiff(dir, "staged");
      expect(staged).toContain("file.txt");
      expect(staged).toContain("+modified");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch {}
    }
  });

  test("returns all diff (vs HEAD)", async () => {
    const dir = join(tmpdir(), `ipe-git-diff-all-${Date.now()}`);
    try {
      const run = await initRepo(dir);
      writeFileSync(join(dir, "file.txt"), "modified\n");
      await run(["git", "add", "."]).exited;

      const result = await runGitDiff(dir, "all");
      expect(result).toContain("file.txt");
      expect(result).toContain("+modified");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch {}
    }
  });

  test("throws on non-git directory", async () => {
    const dir = join(tmpdir(), `ipe-non-git-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      await expect(runGitDiff(dir)).rejects.toThrow("git diff failed");
    } finally {
      try { rmSync(dir, { recursive: true }); } catch {}
    }
  });
});
