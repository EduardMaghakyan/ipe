import { describe, test, expect } from "bun:test";

const HOOK_ENTRY = "apps/hook/server/index.ts";

let nextPort = 19550; // Start high to avoid conflicts with real IPE

function getUniquePort(): number {
  return nextPort++;
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

function spawnHook(stdinData: string, port: number) {
  const proc = Bun.spawn(["bun", HOOK_ENTRY], {
    stdin: new Blob([stdinData]),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      IPE_BROWSER: "true",
      IPE_PORT: String(port),
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

async function waitForRegistered(stderrStream: ReadableStream): Promise<void> {
  const reader = stderrStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stderr stream ended before registration");
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes("registered with server")) {
      reader.releaseLock();
      return;
    }
  }
}

describe("multi-session hook flow", () => {
  test("two hooks share one server, both get independent decisions", async () => {
    const port = getUniquePort();

    // Start hook 1 (server owner)
    const hook1 = spawnHook(
      makeInput("# Plan A\n\nDo thing A", "plan", "session-1"),
      port,
    );
    const { port: actualPort } = await waitForServer(
      hook1.proc.stderr as ReadableStream,
    );
    expect(actualPort).toBe(port);

    // Start hook 2 (client)
    const hook2 = spawnHook(
      makeInput("# Plan B\n\nDo thing B", "plan", "session-2"),
      port,
    );
    await waitForRegistered(hook2.proc.stderr as ReadableStream);

    // Both sessions should be visible
    const sessionsRes = await fetch(`http://localhost:${port}/api/sessions`);
    const sessions = await sessionsRes.json();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s: any) => s.sessionId).sort()).toEqual([
      "session-1",
      "session-2",
    ]);

    // Approve session 1
    await fetch(`http://localhost:${port}/api/sessions/session-1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Good" }),
    });

    // Deny session 2
    await fetch(`http://localhost:${port}/api/sessions/session-2/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Needs work" }),
    });

    // Hook 2 should exit with deny decision
    await hook2.proc.exited;
    const stdout2 = await hook2.stdout();
    const output2 = JSON.parse(stdout2.trim());
    expect(output2.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(output2.hookSpecificOutput.decision.message).toBe("Needs work");

    // Hook 1 should also exit (all sessions resolved)
    const exitCode1 = await Promise.race([
      hook1.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("hook1 did not exit")), 3000),
      ),
    ]);
    expect(exitCode1).toBe(0);

    const stdout1 = await hook1.stdout();
    const output1 = JSON.parse(stdout1.trim());
    expect(output1.hookSpecificOutput.decision.behavior).toBe("allow");
  }, 10000);

  test("single session still works", async () => {
    const port = getUniquePort();

    const hook = spawnHook(
      makeInput("# Test Plan\n\nDo the thing", "plan", "solo"),
      port,
    );
    await waitForServer(hook.proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/solo/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    const exitCode = await Promise.race([
      hook.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("hook did not exit")), 3000),
      ),
    ]);
    expect(exitCode).toBe(0);

    const stdout = await hook.stdout();
    const output = JSON.parse(stdout.trim());
    expect(output.hookSpecificOutput.decision.behavior).toBe("allow");
  }, 10000);

  test("server crash recovery — new hook takes over", async () => {
    const port = getUniquePort();

    // Start hook 1
    const hook1 = spawnHook(
      makeInput("# Plan 1\n\nFirst", "plan", "crash-1"),
      port,
    );
    await waitForServer(hook1.proc.stderr as ReadableStream);

    // Kill hook 1 (simulates crash — port is released)
    hook1.proc.kill();
    await hook1.proc.exited;

    // Wait a moment for port to be released
    await new Promise((r) => setTimeout(r, 200));

    // Start hook 2 — should become server owner on same port
    const hook2 = spawnHook(
      makeInput("# Plan 2\n\nSecond", "plan", "crash-2"),
      port,
    );
    const { port: newPort } = await waitForServer(
      hook2.proc.stderr as ReadableStream,
    );
    expect(newPort).toBe(port);

    // Approve and verify
    await fetch(`http://localhost:${port}/api/sessions/crash-2/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    const exitCode = await Promise.race([
      hook2.proc.exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("hook2 did not exit")), 3000),
      ),
    ]);
    expect(exitCode).toBe(0);
  }, 10000);

  test("simultaneous startup — one becomes owner, other becomes client", async () => {
    const port = getUniquePort();

    // Spawn both at the exact same time
    const hookA = spawnHook(
      makeInput("# Plan A\n\nAlpha", "plan", "sim-a"),
      port,
    );
    const hookB = spawnHook(
      makeInput("# Plan B\n\nBeta", "plan", "sim-b"),
      port,
    );

    // Wait for both to be ready (one as server, one as client)
    // We don't know which is which, so wait for both stderr messages
    const stderrA = new Response(hookA.proc.stderr).text();
    const stderrB = new Response(hookB.proc.stderr).text();

    // Wait until both sessions are registered
    const waitForSessions = async () => {
      for (let i = 0; i < 50; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/api/sessions`);
          if (res.ok) {
            const sessions = await res.json();
            if ((sessions as any[]).length === 2) return sessions;
          }
        } catch {
          // server not ready yet
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("Timed out waiting for both sessions");
    };

    const sessions = await waitForSessions();
    const ids = (sessions as any[]).map((s: any) => s.sessionId).sort();
    expect(ids).toEqual(["sim-a", "sim-b"]);

    // Resolve both
    await fetch(`http://localhost:${port}/api/sessions/sim-a/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });
    await fetch(`http://localhost:${port}/api/sessions/sim-b/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    await Promise.all([hookA.proc.exited, hookB.proc.exited]);

    await stderrA;
    const outA = JSON.parse((await hookA.stdout()).trim());
    await stderrB;
    const outB = JSON.parse((await hookB.stdout()).trim());
    expect(outA.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(outB.hookSpecificOutput.decision.behavior).toBe("allow");
  }, 15000);
});
