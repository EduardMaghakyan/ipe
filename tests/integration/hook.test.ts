import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOOK_ENTRY = "apps/hook/server/index.ts";

// Temp dir for plan-from-disk tests
const tmpDir = join(tmpdir(), `ipe-test-hook-${Date.now()}`);
const plansDir = join(tmpDir, "plans");
const transcriptsDir = join(tmpDir, "transcripts");

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {}
});

let nextPort = 19600; // Unique range to avoid conflicts

function spawnHook(
  stdinData: string,
  extraEnv?: Record<string, string>,
): {
  proc: ReturnType<typeof Bun.spawn>;
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
} {
  const port = nextPort++;
  const proc = Bun.spawn(["bun", HOOK_ENTRY], {
    stdin: new Blob([stdinData]),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      IPE_BROWSER: "true",
      IPE_PORT: String(port),
      ...extraEnv,
    },
  });
  return {
    proc,
    stdout: async () => new Response(proc.stdout).text(),
    stderr: async () => new Response(proc.stderr).text(),
  };
}

async function waitForServer(
  stderrStream: ReadableStream,
): Promise<{ port: number }> {
  const reader = stderrStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stderr stream ended before server started");
    buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/running at http:\/\/localhost:(\d+)/);
    if (match) {
      reader.releaseLock();
      return { port: parseInt(match[1], 10) };
    }
  }
}

function makeInput(
  plan: string,
  permissionMode = "default",
  sessionId?: string,
) {
  return JSON.stringify({
    tool_input: { plan },
    permission_mode: permissionMode,
    session_id: sessionId,
  });
}

describe("hook stdin→stdout flow", () => {
  test("approve flow outputs allow decision", async () => {
    const input = makeInput("# Test Plan\n\nDo the thing", "default", "s1");
    const { proc, stdout } = spawnHook(input);

    const { port } = await waitForServer(proc.stderr as ReadableStream);

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
      proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const out = await stdout();
    const output = JSON.parse(out.trim());

    expect(output.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(output.hookSpecificOutput.decision.behavior).toBe("allow");
  }, 10000);

  test("deny flow outputs deny decision with message", async () => {
    const input = makeInput("# Test Plan\n\nDo the thing", "default", "s1");
    const { proc, stdout } = spawnHook(input);

    const { port } = await waitForServer(proc.stderr as ReadableStream);

    const res = await fetch(`http://localhost:${port}/api/sessions/s1/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Please revise step 2" }),
    });
    expect(res.status).toBe(200);

    await Promise.race([
      proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const out = await stdout();
    const output = JSON.parse(out.trim());

    expect(output.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(output.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(output.hookSpecificOutput.decision.message).toBe(
      "Please revise step 2",
    );
  }, 10000);

  test("deny with no feedback uses default message", async () => {
    const input = makeInput("# Plan\n\nContent", "default", "s1");
    const { proc, stdout } = spawnHook(input);

    const { port } = await waitForServer(proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/s1/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    await Promise.race([
      proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const out = await stdout();
    const output = JSON.parse(out.trim());

    expect(output.hookSpecificOutput.decision.message).toBe(
      "Plan changes requested",
    );
  }, 10000);

  test("process exits after decision", async () => {
    const input = makeInput("# Plan\n\nContent", "default", "s1");
    const { proc } = spawnHook(input);

    const { port } = await waitForServer(proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/s1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    const exitCode = await Promise.race([
      proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    expect(exitCode).toBe(0);
  }, 10000);
});

let nextDiskPort = 19650; // Separate range for disk-fallback tests

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

    const input = JSON.stringify({
      tool_input: {},
      permission_mode: "default",
      session_id: "disk-s1",
      transcript_path: transcriptPath,
    });

    const port = nextDiskPort++;
    const proc = Bun.spawn(["bun", HOOK_ENTRY], {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        IPE_BROWSER: "true",
        IPE_PORT: String(port),
        IPE_PLANS_DIR: plansDir,
      },
    });

    await waitForServer(proc.stderr as ReadableStream);

    // Verify server started and plan was loaded
    const sessionsRes = await fetch(`http://localhost:${port}/api/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessions = (await sessionsRes.json()) as {
      sessionId: string;
      plan: string;
    }[];
    const session = sessions.find((s) => s.sessionId === "disk-s1");
    expect(session).toBeDefined();
    expect(session!.plan).toContain("Loaded from file");

    // Clean up by approving
    await fetch(`http://localhost:${port}/api/sessions/disk-s1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    await Promise.race([
      proc.exited,
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

    const input = JSON.stringify({
      tool_input: {},
      permission_mode: "default",
      session_id: "disk-s2",
    });

    const port = nextDiskPort++;
    const proc = Bun.spawn(["bun", HOOK_ENTRY], {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        IPE_BROWSER: "true",
        IPE_PORT: String(port),
        IPE_PLANS_DIR: plansDir,
      },
    });

    await waitForServer(proc.stderr as ReadableStream);

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
      proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
  }, 15000);
});

// --- diff-review tests ---

let nextDiffPort = 19800;
const diffTmpDir = join(tmpdir(), `ipe-diff-hook-test-${Date.now()}`);

afterAll(() => {
  try {
    rmSync(diffTmpDir, { recursive: true });
  } catch {}
});

const HOOK_ENTRY_ABS = join(process.cwd(), HOOK_ENTRY);

function spawnDiffReview(
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
) {
  const port = nextDiffPort++;
  const proc = Bun.spawn(["bun", HOOK_ENTRY_ABS, "diff-review", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      IPE_BROWSER: "true",
      IPE_PORT: String(port),
      ...extraEnv,
    },
  });
  return {
    proc,
    port,
    stdout: async () => new Response(proc.stdout).text(),
    stderr: async () => new Response(proc.stderr).text(),
  };
}

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

describe("diff-review hook", () => {
  test("exits with 0 when no changes", async () => {
    const repoDir = join(diffTmpDir, "no-changes");
    await initGitRepo(repoDir);

    const { proc, stderr } = spawnDiffReview([], repoDir);

    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000),
      ),
    ]);
    expect(exitCode).toBe(0);

    const err = await stderr();
    expect(err).toContain("No changes to review");
  }, 10000);

  test("starts server when there are unstaged changes", async () => {
    const repoDir = join(diffTmpDir, "unstaged");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "file.txt"), "changed\n");

    const { proc, port } = spawnDiffReview([], repoDir);

    // Read stderr manually to debug and wait for server
    const reader = (proc.stderr as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let serverPort = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`stderr ended. Buffer: ${buffer}`);
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/running at http:\/\/localhost:(\d+)/);
      if (match) {
        serverPort = parseInt(match[1], 10);
        reader.releaseLock();
        break;
      }
    }

    // Server should be running with diff-review session
    const res = await fetch(`http://localhost:${serverPort}/api/sessions`);
    const sessions = await res.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].mode).toBe("diff-review");
    expect(sessions[0].fileDiffs.length).toBeGreaterThan(0);

    // Clean up by approving
    await fetch(
      `http://localhost:${serverPort}/api/sessions/${sessions[0].sessionId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "" }),
      },
    );

    await Promise.race([
      proc.exited,
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

    const { proc, port } = spawnDiffReview(["--staged"], repoDir);

    // waitForServer reads stderr; check the buffer includes mode=staged
    const reader = (proc.stderr as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let serverPort = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stderr ended before server started");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("mode=staged")) {
        const match = buffer.match(/running at http:\/\/localhost:(\d+)/);
        if (match) {
          serverPort = parseInt(match[1], 10);
          break;
        }
      }
    }
    reader.releaseLock();

    expect(buffer).toContain("mode=staged");

    // Clean up by approving
    const sessRes = await fetch(`http://localhost:${serverPort}/api/sessions`);
    const sessions = await sessRes.json();
    await fetch(
      `http://localhost:${serverPort}/api/sessions/${sessions[0].sessionId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "" }),
      },
    );

    await Promise.race([
      proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
  }, 15000);

  test("approve flow outputs allow decision", async () => {
    const repoDir = join(diffTmpDir, "approve-flow");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "file.txt"), "approve test\n");

    const { proc, stdout } = spawnDiffReview([], repoDir);

    const { port: serverPort } = await waitForServer(
      proc.stderr as ReadableStream,
    );

    const sessRes = await fetch(`http://localhost:${serverPort}/api/sessions`);
    const sessions = await sessRes.json();
    const sessionId = sessions[0].sessionId;

    await fetch(
      `http://localhost:${serverPort}/api/sessions/${sessionId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "Looks good" }),
      },
    );

    await Promise.race([
      proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);

    const out = await stdout();
    const output = JSON.parse(out.trim());
    expect(output.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(output.hookSpecificOutput.decision.message).toBeUndefined();
  }, 15000);

  test("deny flow outputs deny decision with feedback", async () => {
    const repoDir = join(diffTmpDir, "deny-flow");
    await initGitRepo(repoDir);
    writeFileSync(join(repoDir, "file.txt"), "deny test\n");

    const { proc, stdout } = spawnDiffReview([], repoDir);

    const { port: serverPort } = await waitForServer(
      proc.stderr as ReadableStream,
    );

    const sessRes = await fetch(`http://localhost:${serverPort}/api/sessions`);
    const sessions = await sessRes.json();
    const sessionId = sessions[0].sessionId;

    await fetch(
      `http://localhost:${serverPort}/api/sessions/${sessionId}/deny`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "Fix the bug" }),
      },
    );

    await Promise.race([
      proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);

    const out = await stdout();
    const output = JSON.parse(out.trim());
    expect(output.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(output.hookSpecificOutput.decision.message).toBe("Fix the bug");
  }, 15000);
});
