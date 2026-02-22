import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  extractFileRefs,
  resolveSnippets,
} from "../../packages/server/snippets";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("extractFileRefs", () => {
  test("extracts simple file path", () => {
    const refs = extractFileRefs("Modify `src/index.ts` to add the feature");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("src/index.ts");
    expect(refs[0].startLine).toBeUndefined();
  });

  test("extracts file path with single line number", () => {
    const refs = extractFileRefs("See `src/utils.ts:42` for details");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("src/utils.ts");
    expect(refs[0].startLine).toBe(42);
    expect(refs[0].endLine).toBe(42);
  });

  test("extracts file path with line range", () => {
    const refs = extractFileRefs(
      "Update `lib/auth.ts:10-25` with the new logic",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("lib/auth.ts");
    expect(refs[0].startLine).toBe(10);
    expect(refs[0].endLine).toBe(25);
  });

  test("extracts multiple file refs", () => {
    const md = "Modify `src/a.ts` and `src/b.js` then check `config.json`";
    const refs = extractFileRefs(md);
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.path)).toEqual([
      "src/a.ts",
      "src/b.js",
      "config.json",
    ]);
  });

  test("deduplicates same file reference", () => {
    const md = "First `src/app.ts`, then again `src/app.ts`";
    const refs = extractFileRefs(md);
    expect(refs).toHaveLength(1);
  });

  test("ignores non-file backtick content", () => {
    const md = "Run `npm install` and `git status` then `true`";
    const refs = extractFileRefs(md);
    expect(refs).toHaveLength(0);
  });

  test("ignores paths inside fenced code blocks", () => {
    const md =
      "Modify `src/real.ts` here\n\n```typescript\nimport from 'src/inside-code.ts'\n```\n\nAlso `src/other.ts`";
    const refs = extractFileRefs(md);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.path)).toEqual(["src/real.ts", "src/other.ts"]);
  });

  test("handles various extensions", () => {
    const md = "`app.py` `main.go` `style.css` `page.svelte` `schema.sql`";
    const refs = extractFileRefs(md);
    expect(refs).toHaveLength(5);
  });

  test("ignores unknown extensions", () => {
    const md = "`file.xyz` `data.unknown`";
    const refs = extractFileRefs(md);
    expect(refs).toHaveLength(0);
  });
});

describe("resolveSnippets", () => {
  const tmpDir = join(tmpdir(), `ipe-test-snippets-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/small.ts"),
      Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"),
    );
    writeFileSync(
      join(tmpDir, "src/large.ts"),
      Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n"),
    );
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  test("resolves small file content", async () => {
    const snippets = await resolveSnippets("Check `src/small.ts`", tmpDir);
    expect(snippets).toHaveLength(1);
    expect(snippets[0].path).toBe("src/small.ts");
    expect(snippets[0].content).toContain("line 1");
    expect(snippets[0].error).toBeUndefined();
  });

  test("truncates large files", async () => {
    const snippets = await resolveSnippets("Check `src/large.ts`", tmpDir);
    expect(snippets).toHaveLength(1);
    expect(snippets[0].error).toContain("truncated");
    expect(snippets[0].content.split("\n").length).toBe(200);
  });

  test("extracts line range with context", async () => {
    const snippets = await resolveSnippets("See `src/small.ts:3-5`", tmpDir);
    expect(snippets).toHaveLength(1);
    // With 5 lines of context: start = max(1, 3-5) = 1, end = min(10, 5+5) = 10
    expect(snippets[0].startLine).toBe(1);
    expect(snippets[0].endLine).toBe(10);
    expect(snippets[0].content).toContain("line 1");
  });

  test("handles missing file", async () => {
    const snippets = await resolveSnippets("Check `src/missing.ts`", tmpDir);
    expect(snippets).toHaveLength(1);
    expect(snippets[0].error).toBe("File not found");
    expect(snippets[0].content).toBe("");
  });
});
