import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  slugFromTranscript,
  readPlanFromDisk,
} from "../../packages/server/plan-file";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = join(tmpdir(), `ipe-test-plan-file-${Date.now()}`);
const plansDir = join(tmpDir, "plans");
const transcriptsDir = join(tmpDir, "transcripts");

beforeAll(() => {
  mkdirSync(plansDir, { recursive: true });
  mkdirSync(transcriptsDir, { recursive: true });

  const now = Date.now();

  // Create plan files with explicit staggered mtimes
  writeFileSync(join(plansDir, "old-plan.md"), "# Old Plan\n\nOld content");
  utimesSync(
    join(plansDir, "old-plan.md"),
    new Date(now - 20000),
    new Date(now - 20000),
  );

  writeFileSync(
    join(plansDir, "my-cool-slug.md"),
    "# Plan from slug\n\nSlug content",
  );
  utimesSync(
    join(plansDir, "my-cool-slug.md"),
    new Date(now - 10000),
    new Date(now - 10000),
  );

  writeFileSync(
    join(plansDir, "newest-plan.md"),
    "# Newest Plan\n\nNewest content",
  );
  // newest-plan.md keeps the current mtime (most recent)

  // Create transcript JSONL files
  writeFileSync(
    join(transcriptsDir, "session1.jsonl"),
    [
      JSON.stringify({ slug: "my-cool-slug", message: "first" }),
      JSON.stringify({ slug: "my-cool-slug", message: "second" }),
    ].join("\n"),
  );

  writeFileSync(
    join(transcriptsDir, "no-slug.jsonl"),
    [
      JSON.stringify({ message: "first" }),
      JSON.stringify({ message: "second" }),
    ].join("\n"),
  );

  writeFileSync(
    join(transcriptsDir, "partial-slug.jsonl"),
    [
      JSON.stringify({ message: "no slug here" }),
      JSON.stringify({ slug: "my-cool-slug", message: "has slug" }),
    ].join("\n"),
  );

  writeFileSync(join(transcriptsDir, "malformed.jsonl"), "not json\n{bad\n");
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {}
});

describe("slugFromTranscript", () => {
  test("extracts slug from valid JSONL", () => {
    const slug = slugFromTranscript(
      join(transcriptsDir, "session1.jsonl"),
    );
    expect(slug).toBe("my-cool-slug");
  });

  test("returns null when no slug field", () => {
    const slug = slugFromTranscript(
      join(transcriptsDir, "no-slug.jsonl"),
    );
    expect(slug).toBeNull();
  });

  test("returns null for non-existent file", () => {
    const slug = slugFromTranscript("/nonexistent/path/transcript.jsonl");
    expect(slug).toBeNull();
  });

  test("returns null for malformed JSONL", () => {
    const slug = slugFromTranscript(
      join(transcriptsDir, "malformed.jsonl"),
    );
    expect(slug).toBeNull();
  });

  test("finds slug when only some lines have it", () => {
    const slug = slugFromTranscript(
      join(transcriptsDir, "partial-slug.jsonl"),
    );
    expect(slug).toBe("my-cool-slug");
  });
});

describe("readPlanFromDisk", () => {
  const originalError = console.error;
  beforeAll(() => {
    console.error = () => {};
  });
  afterAll(() => {
    console.error = originalError;
  });

  test("tier 1: reads plan via transcript slug", () => {
    const plan = readPlanFromDisk(
      join(transcriptsDir, "session1.jsonl"),
      plansDir,
    );
    expect(plan).toContain("Slug content");
  });

  test("tier 2: falls back to most recent .md when no transcript", () => {
    const plan = readPlanFromDisk(undefined, plansDir);
    expect(plan).toContain("Newest content");
  });

  test("tier 2: falls back when transcript slug file doesn't exist", () => {
    // Create transcript with slug that has no matching plan file
    const noMatchTranscript = join(transcriptsDir, "no-match.jsonl");
    writeFileSync(
      noMatchTranscript,
      JSON.stringify({ slug: "nonexistent-slug" }),
    );
    const plan = readPlanFromDisk(noMatchTranscript, plansDir);
    expect(plan).toContain("Newest content");
  });

  test("returns empty string when plans dir doesn't exist", () => {
    const plan = readPlanFromDisk(undefined, "/nonexistent/plans/dir");
    expect(plan).toBe("");
  });

  test("returns empty string when plans dir has no .md files", () => {
    const emptyDir = join(tmpDir, "empty-plans");
    mkdirSync(emptyDir, { recursive: true });
    const plan = readPlanFromDisk(undefined, emptyDir);
    expect(plan).toBe("");
  });

  test("prefers tier 1 over tier 2", () => {
    const plan = readPlanFromDisk(
      join(transcriptsDir, "session1.jsonl"),
      plansDir,
    );
    // Should get slug plan, not newest plan
    expect(plan).toContain("Slug content");
    expect(plan).not.toContain("Newest content");
  });
});
