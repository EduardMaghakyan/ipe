import { describe, test, expect } from "bun:test";
import { spawnHook, waitForListening, makeHookInput } from "./_helpers";

describe("in-process server model", () => {
  test("multiple concurrent hooks each get an ephemeral port and resolve independently", async () => {
    const hooks = [1, 2, 3].map((i) =>
      spawnHook({
        // No port hint — each hook gets its own ephemeral port.
        port: 0,
        stdinData: makeHookInput({
          plan: `# Plan ${i}\n\nDo thing ${i}`,
          sessionId: `concurrent-${i}`,
        }),
      }),
    );

    const ports = await Promise.all(
      hooks.map((h) => waitForListening(h.proc.stderr as ReadableStream)),
    );
    const portNums = ports.map((p) => p.port);
    expect(new Set(portNums).size).toBe(3);

    // Each hook owns its own server — POST to each port resolves only that hook.
    await Promise.all(
      portNums.map((port, i) =>
        fetch(
          `http://localhost:${port}/api/sessions/concurrent-${i + 1}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedback: `ok-${i + 1}` }),
          },
        ),
      ),
    );

    await Promise.all(
      hooks.map((h) =>
        Promise.race([
          h.proc.exited,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("hook timeout")), 5000),
          ),
        ]),
      ),
    );

    const outs = await Promise.all(hooks.map((h) => h.stdout()));
    for (const out of outs) {
      const parsed = JSON.parse(out.trim());
      expect(parsed.hookSpecificOutput.decision.behavior).toBe("allow");
    }
  }, 20000);

  test("EADDRINUSE on preferred IPE_PORT falls back to ephemeral port", async () => {
    // Squat the preferred port first.
    const squatter = Bun.serve({
      port: 0,
      fetch: () => new Response("squat"),
    });
    const squatPort = squatter.port;

    try {
      const hook = spawnHook({
        port: squatPort,
        stdinData: makeHookInput({
          plan: "# Plan\n\nFallback port test",
          sessionId: "fallback-1",
        }),
      });
      const { port } = await waitForListening(
        hook.proc.stderr as ReadableStream,
      );
      expect(port).not.toBe(squatPort);

      await fetch(`http://localhost:${port}/api/sessions/fallback-1/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "" }),
      });

      await Promise.race([
        hook.proc.exited,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("hook timeout")), 3000),
        ),
      ]);
      const out = JSON.parse((await hook.stdout()).trim());
      expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
    } finally {
      squatter.stop();
    }
  }, 10000);

  test("hook bails with deny if stdin is silent past the timeout", async () => {
    // Use a very short stdin timeout via env override.
    const proc = Bun.spawn(
      ["bun", `${process.cwd()}/apps/hook/server/index.ts`],
      {
        // No stdin pipe — the child will hang reading stdin until the timeout
        // (Bun.stdin.stream() blocks waiting for data).
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          IPE_BROWSER: "true",
          IPE_STDIN_TIMEOUT_MS: "300",
        },
      },
    );

    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((_, reject) =>
        setTimeout(
          () => reject(new Error("hook didn't exit on stdin timeout")),
          5000,
        ),
      ),
    ]);
    expect(exitCode).toBe(1);
    const out = (await new Response(proc.stdout).text()).trim();
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(parsed.hookSpecificOutput.decision.message).toContain("no input");
  }, 10000);

  test("SIGTERM during stdin read → graceful deny on stdout", async () => {
    // Race: a SIGTERM that arrives before the review has started must still
    // produce a well-formed JSON decision on stdout. Without the bootstrap
    // handler at the top of main(), the default action would kill the
    // process silently and Claude Code would see an empty stdout.
    const proc = Bun.spawn(
      ["bun", `${process.cwd()}/apps/hook/server/index.ts`],
      {
        // Hold stdin open so the child waits in readStdinWithTimeout.
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          IPE_BROWSER: "true",
          // Long stdin timeout — we want the child blocked on stdin when
          // the SIGTERM lands, not racing the timeout path.
          IPE_STDIN_TIMEOUT_MS: "30000",
        },
      },
    );

    // Yield to let the child reach the stdin-read await.
    await new Promise((r) => setTimeout(r, 200));
    proc.kill("SIGTERM");

    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((_, reject) =>
        setTimeout(
          () => reject(new Error("hook didn't exit on SIGTERM during stdin")),
          3000,
        ),
      ),
    ]);
    expect(exitCode).toBe(0);
    const out = (await new Response(proc.stdout).text()).trim();
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(parsed.hookSpecificOutput.decision.message).toContain("canceled");
  }, 10000);

  test("SIGTERM before decision → graceful deny on stdout", async () => {
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nSIGTERM test",
        sessionId: "sig-1",
      }),
    });
    await waitForListening(hook.proc.stderr as ReadableStream);

    hook.proc.kill("SIGTERM");

    const exitCode = await Promise.race([
      hook.proc.exited,
      new Promise<number>((_, reject) =>
        setTimeout(
          () => reject(new Error("hook didn't exit on SIGTERM")),
          3000,
        ),
      ),
    ]);
    expect(exitCode).toBe(0);

    const out = (await hook.stdout()).trim();
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(parsed.hookSpecificOutput.decision.message).toContain("canceled");
  }, 10000);

  test("hook exits cleanly after approve even with an active SSE client", async () => {
    // Simulates a real browser tab keeping a long-lived /api/events
    // connection open. server.stop(true) must force-close these, otherwise the
    // hook would hang indefinitely after the user clicks approve.
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nSSE keep-alive test",
        sessionId: "sse-1",
      }),
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    // Open a long-lived SSE subscription and *actually drain* the response
    // body — this is what a real browser does. If the server fails to close
    // the connection on stop, the reader will hang and the test times out.
    const sseRes = await fetch(`http://localhost:${port}/api/events`);
    expect(sseRes.ok).toBe(true);
    const reader = sseRes.body!.getReader();
    // Read the initial `event: init` frame so we know the connection is live.
    const first = await Promise.race([
      reader.read(),
      new Promise<{ done: boolean; value: Uint8Array | undefined }>((_, rej) =>
        setTimeout(() => rej(new Error("no SSE init frame")), 2000),
      ),
    ]);
    expect(first.done).toBe(false);

    // Approve in the background and concurrently keep reading from SSE
    // until the server closes the connection. The reader observing
    // `done: true` OR a connection-reset error both prove that the server
    // released the connection — without server.stop(true), the reader
    // would simply hang here and we'd time out.
    const drainPromise = (async (): Promise<"done" | "reset"> => {
      while (true) {
        try {
          const { done } = await reader.read();
          if (done) return "done";
        } catch {
          return "reset";
        }
      }
    })();

    await fetch(`http://localhost:${port}/api/sessions/sse-1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    const drained = await Promise.race([
      drainPromise,
      new Promise<"timeout">((_, rej) =>
        setTimeout(
          () => rej(new Error("SSE reader did not unblock after server stop")),
          3000,
        ),
      ),
    ]);
    expect(["done", "reset"]).toContain(drained);

    const exitCode = await Promise.race([
      hook.proc.exited,
      new Promise<number>((_, reject) =>
        setTimeout(
          () => reject(new Error("hook hung after approve with active SSE")),
          3000,
        ),
      ),
    ]);
    expect(exitCode).toBe(0);

    const out = JSON.parse((await hook.stdout()).trim());
    expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
  }, 10000);

  test("hook exits cleanly when browser tab is closed without approving", async () => {
    // If the user closes the tab before deciding, the SSE EventSource
    // disconnects. The hook should NOT exit — we still want a real decision.
    // This test verifies the decision-promise stays pending across SSE drops.
    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nTab-close test",
        sessionId: "tab-1",
      }),
    });
    const { port } = await waitForListening(hook.proc.stderr as ReadableStream);

    // Open and then immediately drop an SSE subscription, simulating a tab
    // close before the user clicks anything.
    const sseAbort = new AbortController();
    const ssePromise = fetch(`http://localhost:${port}/api/events`, {
      signal: sseAbort.signal,
    });
    await new Promise((r) => setTimeout(r, 100));
    sseAbort.abort();
    await ssePromise.catch(() => {});

    // Hook should still be running; SSE drop alone is not a decision.
    await new Promise((r) => setTimeout(r, 300));
    const sessionsRes = await fetch(`http://localhost:${port}/api/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessions = (await sessionsRes.json()) as { sessionId: string }[];
    expect(sessions.find((s) => s.sessionId === "tab-1")).toBeDefined();

    // Now actually deny — hook should resolve and exit.
    await fetch(`http://localhost:${port}/api/sessions/tab-1/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "later" }),
    });

    const exitCode = await Promise.race([
      hook.proc.exited,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("hook didn't exit")), 3000),
      ),
    ]);
    expect(exitCode).toBe(0);
  }, 10000);
});
