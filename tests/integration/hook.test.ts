import { describe, test, expect } from "bun:test";

const HOOK_ENTRY = "apps/hook/server/index.ts";

let nextPort = 19600; // Unique range to avoid conflicts

function spawnHook(stdinData: string): {
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
