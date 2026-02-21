import { describe, test, expect } from "bun:test";

const HOOK_ENTRY = "apps/hook/server/index.ts";

function spawnHook(stdinData: string): {
  proc: ReturnType<typeof Bun.spawn>;
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
} {
  const proc = Bun.spawn(["bun", HOOK_ENTRY], {
    stdin: new Blob([stdinData]),
    stdout: "pipe",
    stderr: "pipe",
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

function makeInput(plan: string, permissionMode = "default") {
  return JSON.stringify({
    tool_input: { plan },
    permission_mode: permissionMode,
  });
}

describe("hook stdin→stdout flow", () => {
  test("approve flow outputs allow decision", async () => {
    const input = makeInput("# Test Plan\n\nDo the thing");
    const proc = Bun.spawn(["bun", HOOK_ENTRY], {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, IPE_BROWSER: "true" },
    });

    const { port } = await waitForServer(proc.stderr as ReadableStream);

    const res = await fetch(`http://localhost:${port}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });
    expect(res.status).toBe(200);

    await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const output = JSON.parse(stdout.trim());

    expect(output.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(output.hookSpecificOutput.decision.behavior).toBe("allow");
  });

  test("deny flow outputs deny decision with message", async () => {
    const input = makeInput("# Test Plan\n\nDo the thing");
    const proc = Bun.spawn(["bun", HOOK_ENTRY], {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, IPE_BROWSER: "true" },
    });

    const { port } = await waitForServer(proc.stderr as ReadableStream);

    const res = await fetch(`http://localhost:${port}/api/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Please revise step 2" }),
    });
    expect(res.status).toBe(200);

    await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const output = JSON.parse(stdout.trim());

    expect(output.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(output.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(output.hookSpecificOutput.decision.message).toBe(
      "Please revise step 2",
    );
  });

  test("deny with no feedback uses default message", async () => {
    const input = makeInput("# Plan\n\nContent");
    const proc = Bun.spawn(["bun", HOOK_ENTRY], {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, IPE_BROWSER: "true" },
    });

    const { port } = await waitForServer(proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const output = JSON.parse(stdout.trim());

    expect(output.hookSpecificOutput.decision.message).toBe(
      "Plan changes requested",
    );
  });

  test("process exits after decision", async () => {
    const input = makeInput("# Plan\n\nContent");
    const proc = Bun.spawn(["bun", HOOK_ENTRY], {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, IPE_BROWSER: "true" },
    });

    const { port } = await waitForServer(proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });
});
