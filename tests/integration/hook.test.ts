import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
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
    const sessionsRes = await fetch(
      `http://localhost:${port}/api/sessions`,
    );
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

    const sessionsRes = await fetch(
      `http://localhost:${port}/api/sessions`,
    );
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
