import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  nextUniquePort,
  spawnHook,
  waitForRegistered,
  readHelperPid,
  killHelper,
  makeHookInput,
} from "./_helpers";

const sessionLockDirs: string[] = [];

afterEach(async () => {
  for (const dir of sessionLockDirs.splice(0)) {
    await killHelper(dir);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function freshLockDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ipe-multi-"));
  sessionLockDirs.push(dir);
  return dir;
}

describe("multi-session hook flow", () => {
  test("two hooks share one helper, both get independent decisions", async () => {
    const lockDir = freshLockDir();
    const port = nextUniquePort();

    const hook1 = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan A\n\nDo thing A",
        sessionId: "session-1",
      }),
      port,
      lockDir,
    });
    const { port: helperPort } = await waitForRegistered(
      hook1.proc.stderr as ReadableStream,
    );
    expect(helperPort).toBe(port);

    const hook2 = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan B\n\nDo thing B",
        sessionId: "session-2",
      }),
      port,
      lockDir,
    });
    await waitForRegistered(hook2.proc.stderr as ReadableStream);

    const sessionsRes = await fetch(`http://localhost:${port}/api/sessions`);
    const sessions = (await sessionsRes.json()) as { sessionId: string }[];
    expect(sessions.map((s) => s.sessionId).sort()).toEqual([
      "session-1",
      "session-2",
    ]);

    await fetch(`http://localhost:${port}/api/sessions/session-1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Good" }),
    });
    await fetch(`http://localhost:${port}/api/sessions/session-2/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Needs work" }),
    });

    await Promise.all([hook1.proc.exited, hook2.proc.exited]);

    const out1 = JSON.parse((await hook1.stdout()).trim());
    const out2 = JSON.parse((await hook2.stdout()).trim());
    expect(out1.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(out2.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(out2.hookSpecificOutput.decision.message).toBe("Needs work");
  }, 15000);

  test("killing the hook does not stop the helper", async () => {
    const lockDir = freshLockDir();
    const port = nextUniquePort();

    const hook1 = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nFirst",
        sessionId: "kill-1",
      }),
      port,
      lockDir,
    });
    await waitForRegistered(hook1.proc.stderr as ReadableStream);

    const helperPidBefore = readHelperPid(lockDir);
    expect(typeof helperPidBefore).toBe("number");

    // Kill the hook — its parent process. Helper must survive.
    hook1.proc.kill();
    await hook1.proc.exited;

    // Helper still alive and serving.
    await new Promise((r) => setTimeout(r, 200));
    const health = await fetch(`http://localhost:${port}/api/health`);
    expect(health.ok).toBe(true);
    const helperPidAfter = readHelperPid(lockDir);
    expect(helperPidAfter).toBe(helperPidBefore!);

    // A fresh hook can join the same helper.
    const hook2 = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nSecond",
        sessionId: "kill-2",
      }),
      port,
      lockDir,
    });
    await waitForRegistered(hook2.proc.stderr as ReadableStream);

    await fetch(`http://localhost:${port}/api/sessions/kill-2/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });
    await hook2.proc.exited;

    const out2 = JSON.parse((await hook2.stdout()).trim());
    expect(out2.hookSpecificOutput.decision.behavior).toBe("allow");
  }, 15000);

  test("duplicate POST with same sessionId is idempotent (no second session created)", async () => {
    const lockDir = freshLockDir();
    const port = nextUniquePort();

    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nDup",
        sessionId: "dup-1",
      }),
      port,
      lockDir,
    });
    await waitForRegistered(hook.proc.stderr as ReadableStream);

    // Manual second POST with the same sessionId — server must dedupe.
    const dup = await fetch(`http://localhost:${port}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "dup-1",
        plan: "# Plan\n\nDup",
        permissionMode: "default",
      }),
    });
    const dupBody = (await dup.json()) as { ok: boolean; deduped?: boolean };
    expect(dupBody.ok).toBe(true);
    expect(dupBody.deduped).toBe(true);

    const list = (await (
      await fetch(`http://localhost:${port}/api/sessions`)
    ).json()) as unknown[];
    expect(list).toHaveLength(1);

    await fetch(`http://localhost:${port}/api/sessions/dup-1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });
    await hook.proc.exited;
  }, 15000);

  test("POST during draining returns 503", async () => {
    const lockDir = freshLockDir();
    const port = nextUniquePort();

    const hook = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nDrain",
        sessionId: "drain-1",
      }),
      port,
      lockDir,
    });
    await waitForRegistered(hook.proc.stderr as ReadableStream);

    // Resolve the in-flight session so the hook exits cleanly later.
    await fetch(`http://localhost:${port}/api/sessions/drain-1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });
    await hook.proc.exited;

    // Trigger helper shutdown — sets draining=true synchronously.
    await fetch(`http://localhost:${port}/api/shutdown`, { method: "POST" });

    // Immediate POST against the still-listening helper must get 503.
    const res = await fetch(`http://localhost:${port}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "drain-late",
        plan: "# x",
        permissionMode: "default",
      }),
    });
    expect(res.status).toBe(503);
  }, 15000);

  test("hook respawns helper when lock points to a dead PID", async () => {
    const lockDir = freshLockDir();
    const port = nextUniquePort();

    // Boot a helper, then SIGKILL it so the lock points to a dead PID.
    const hook1 = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nA",
        sessionId: "stale-1",
      }),
      port,
      lockDir,
    });
    await waitForRegistered(hook1.proc.stderr as ReadableStream);
    const oldPid = readHelperPid(lockDir)!;
    expect(oldPid).toBeGreaterThan(0);

    // Approve so hook 1 exits cleanly, then SIGKILL the helper to leave a
    // stale lock.
    await fetch(`http://localhost:${port}/api/sessions/stale-1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });
    await hook1.proc.exited;
    try {
      process.kill(oldPid, "SIGKILL");
    } catch {
      // already gone
    }
    // Wait until port is free.
    for (let i = 0; i < 50; i++) {
      const h = await fetch(`http://localhost:${port}/api/health`).catch(
        () => null,
      );
      if (!h) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // New hook should detect stale lock, spawn a fresh helper.
    const hook2 = spawnHook({
      stdinData: makeHookInput({
        plan: "# Plan\n\nB",
        sessionId: "stale-2",
      }),
      port,
      lockDir,
    });
    await waitForRegistered(hook2.proc.stderr as ReadableStream);
    const newPid = readHelperPid(lockDir)!;
    expect(newPid).not.toBe(oldPid);

    await fetch(`http://localhost:${port}/api/sessions/stale-2/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });
    await hook2.proc.exited;
  }, 20000);
});
