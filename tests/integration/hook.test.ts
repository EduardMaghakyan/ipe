import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnHook, waitForListening, makeHookInput } from "./_helpers";

const tmpDir = mkdtempSync(join(tmpdir(), "ipe-test-hook-"));
const plansDir = join(tmpDir, "plans");
const transcriptsDir = join(tmpDir, "transcripts");
const diffTmpDir = mkdtempSync(join(tmpdir(), "ipe-diff-hook-"));

afterAll(() => {
  for (const dir of [tmpDir, diffTmpDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("hook stdin→stdout flow", () => {
  test("approve flow outputs allow decision", async () => {
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Test Plan\n\nDo the thing",
        sessionId: "s1",
      }),
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    const res = await fetch(
      `http://localhost:${port}/api/sessions/s1/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "" }),
      },
    );
    expect(res.status).toBe(200);

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const out = JSON.parse((await hook.stdout()).trim());
    expect(out.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
  }, 10000);

  test("deny flow outputs deny decision with message", async () => {
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Test Plan\n\nDo the thing",
        sessionId: "s1",
      }),
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/s1/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Please revise step 2" }),
    });

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const out = JSON.parse((await hook.stdout()).trim());
    expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(out.hookSpecificOutput.decision.message).toBe(
      "Please revise step 2",
    );
  }, 10000);

  test("deny with no feedback uses default message", async () => {
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nContent",
        sessionId: "s1",
      }),
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/s1/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const out = JSON.parse((await hook.stdout()).trim());
    expect(out.hookSpecificOutput.decision.message).toBe(
      "Plan changes requested",
    );
  }, 10000);

  test("process exits after decision", async () => {
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nContent",
        sessionId: "s1",
      }),
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/s1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    const exitCode = await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    expect(exitCode).toBe(0);
  }, 10000);
});

describe("hook reads plan from disk when tool_input is empty", () => {
  test("reads plan via transcript slug fallback", async () => {
    mkdirSync(plansDir, { recursive: true });
    mkdirSync(transcriptsDir, { recursive: true });

    writeFileSync(
      join(plansDir, "test-slug.md"),
      "# Disk Plan\n\nLoaded from file",
    );
    const transcriptPath = join(transcriptsDir, "session.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({ slug: "test-slug", message: "entry" }),
    );

    const hook = spawnHook({
      stdinData: JSON.stringify({
        tool_input: {},
        permission_mode: "default",
        session_id: "disk-s1",
        transcript_path: transcriptPath,
      }),
      extraEnv: { IPE_PLANS_DIR: plansDir },
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    const sessionsRes = await fetch(`http://localhost:${port}/api/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessions = (await sessionsRes.json()) as {
      sessionId: string;
      plan: string;
    }[];
    const session = sessions.find((s) => s.sessionId === "disk-s1");
    expect(session).toBeDefined();
    expect(session!.plan).toContain("Loaded from file");

    await fetch(`http://localhost:${port}/api/sessions/disk-s1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
  }, 15000);

  test("reads most recent plan when no transcript path", async () => {
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, "fallback-plan.md"),
      "# Fallback\n\nMost recent plan",
    );

    const hook = spawnHook({
      stdinData: JSON.stringify({
        tool_input: {},
        permission_mode: "default",
        session_id: "disk-s2",
      }),
      extraEnv: { IPE_PLANS_DIR: plansDir },
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    const sessionsRes = await fetch(`http://localhost:${port}/api/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessions = (await sessionsRes.json()) as {
      sessionId: string;
      plan: string;
    }[];
    const session = sessions.find((s) => s.sessionId === "disk-s2");
    expect(session).toBeDefined();
    expect(session!.plan).toContain("Most recent plan");

    await fetch(`http://localhost:${port}/api/sessions/disk-s2/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
  }, 15000);
});

async function initGitRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  const run = (cmd: string[]) =>
    Bun.spawn(cmd, { cwd: dir, stdout: "pipe", stderr: "pipe" });
  await run(["git", "init"]).exited;
  await run(["git", "config", "user.email", "test@test.com"]).exited;
  await run(["git", "config", "user.name", "Test"]).exited;
  writeFileSync(join(dir, "file.txt"), "original\n");
  await run(["git", "add", "."]).exited;
  await run(["git", "commit", "-m", "init"]).exited;
}

function spawnDiffReview(
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
) {
  return spawnHook({
    stdinData: "",
    cwd,
    argv: ["diff-review", ...args],
    extraEnv,
  });
}

describe("diff-review hook", () => {
  test("exits with 0 when no changes", async () => {
    const repoDir = join(diffTmpDir, "no-changes");
    await initGitRepo(repoDir);

    const hook = spawnDiffReview([], repoDir);

    const exitCode = await Promise.race([
      hook.proc.exited,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000),
      ),
    ]);
    expect(exitCode).toBe(0);

    const err = await hook.stderr();
    expect(err).toContain("No changes to review");
  }, 10000);

  test("registers a diff-review session when there are unstaged changes", async () => {
    const repoDir = join(diffTmpDir, "unstaged");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "file.txt"), "changed\n");

    const hook = spawnDiffReview([], repoDir);
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    const res = await fetch(`http://localhost:${port}/api/sessions`);
    const sessions = (await res.json()) as {
      sessionId: string;
      mode: string;
      fileDiffs: unknown[];
    }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].mode).toBe("diff-review");
    expect(sessions[0].fileDiffs.length).toBeGreaterThan(0);

    await fetch(
      `http://localhost:${port}/api/sessions/${sessions[0].sessionId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "" }),
      },
    );

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
  }, 15000);

  test("--staged flag uses staged diff mode", async () => {
    const repoDir = join(diffTmpDir, "staged");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "file.txt"), "staged change\n");
    await Bun.spawn(["git", "add", "."], {
      cwd: repoDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const hook = spawnDiffReview(["--staged"], repoDir);
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    const sessRes = await fetch(`http://localhost:${port}/api/sessions`);
    const sessions = (await sessRes.json()) as { sessionId: string }[];
    expect(sessions).toHaveLength(1);

    await fetch(
      `http://localhost:${port}/api/sessions/${sessions[0].sessionId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "" }),
      },
    );
    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
  }, 15000);

  test("approve flow outputs allow decision", async () => {
    const repoDir = join(diffTmpDir, "approve-flow");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "file.txt"), "approve test\n");

    const hook = spawnDiffReview([], repoDir);
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    const sessions = (await (
      await fetch(`http://localhost:${port}/api/sessions`)
    ).json()) as { sessionId: string }[];
    const sessionId = sessions[0].sessionId;

    await fetch(`http://localhost:${port}/api/sessions/${sessionId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Looks good" }),
    });

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);

    const out = JSON.parse((await hook.stdout()).trim());
    expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(out.hookSpecificOutput.decision.message).toBeUndefined();
  }, 15000);

  test("deny flow outputs deny decision with feedback", async () => {
    const repoDir = join(diffTmpDir, "deny-flow");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "file.txt"), "deny test\n");

    const hook = spawnDiffReview([], repoDir);
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    const sessions = (await (
      await fetch(`http://localhost:${port}/api/sessions`)
    ).json()) as { sessionId: string }[];
    const sessionId = sessions[0].sessionId;

    await fetch(`http://localhost:${port}/api/sessions/${sessionId}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Fix the bug" }),
    });

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);

    const out = JSON.parse((await hook.stdout()).trim());
    expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(out.hookSpecificOutput.decision.message).toBe("Fix the bug");
  }, 15000);
});

describe("accept mode stdout output", () => {
  test("auto-approve mode outputs updatedPermissions", async () => {
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nContent",
        sessionId: "am1",
      }),
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/am1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "", acceptMode: "auto-approve" }),
    });

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const out = JSON.parse((await hook.stdout()).trim());
    const decision = out.hookSpecificOutput.decision;
    expect(decision.behavior).toBe("allow");
    expect(decision.updatedPermissions).toEqual([
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ]);
  }, 10000);

  test("normal accept mode outputs no extra fields", async () => {
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nContent",
        sessionId: "am3",
      }),
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/am3/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "", acceptMode: "normal" }),
    });

    await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const out = JSON.parse((await hook.stdout()).trim());
    const decision = out.hookSpecificOutput.decision;
    expect(decision.behavior).toBe("allow");
    expect(decision.updatedPermissions).toBeUndefined();
  }, 10000);
});
