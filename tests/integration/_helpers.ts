import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOOK_ENTRY = join(process.cwd(), "apps/hook/server/index.ts");

let nextPort = 19600;
let nextLockId = 0;

export function nextUniquePort(): number {
  return nextPort++;
}

export function makeLockDir(baseDir: string): string {
  const dir = join(baseDir, `lock-${nextLockId++}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface SpawnedHook {
  proc: ReturnType<typeof Bun.spawn>;
  port: number;
  lockDir: string;
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
}

export interface SpawnHookOptions {
  stdinData: string;
  port?: number;
  lockDir: string;
  cwd?: string;
  argv?: string[];
  extraEnv?: Record<string, string>;
}

export function spawnHook(opts: SpawnHookOptions): SpawnedHook {
  const port = opts.port ?? nextUniquePort();
  const args = ["bun", HOOK_ENTRY, ...(opts.argv ?? [])];
  const proc = Bun.spawn(args, {
    stdin: new Blob([opts.stdinData]),
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts.cwd,
    env: {
      ...process.env,
      IPE_BROWSER: "true",
      IPE_PORT: String(port),
      IPE_LOCK_DIR: opts.lockDir,
      ...opts.extraEnv,
    },
  });
  return {
    proc,
    port,
    lockDir: opts.lockDir,
    stdout: async () => new Response(proc.stdout).text(),
    stderr: async () => new Response(proc.stderr).text(),
  };
}

/**
 * Wait until the hook prints "registered with helper at http://localhost:N".
 * Returns the port the helper bound to (may differ from IPE_PORT if the
 * env-supplied port was already in use).
 */
export async function waitForRegistered(
  stderrStream: ReadableStream,
  timeoutMs = 8000,
): Promise<{ port: number }> {
  const reader = stderrStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(
          `stderr stream ended before registration. Buffer: ${buffer}`,
        );
      }
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(
        /registered with helper at http:\/\/localhost:(\d+)/,
      );
      if (match) {
        return { port: parseInt(match[1], 10) };
      }
    }
    throw new Error(
      `Timed out waiting for "registered with helper". Buffer: ${buffer}`,
    );
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read the helper PID from the lock file (if present).
 */
export function readHelperPid(lockDir: string): number | null {
  const path = join(lockDir, "server.lock");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof data.pid === "number") return data.pid;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Tear down the helper for a given lock dir if it's still running.
 */
export async function killHelper(lockDir: string): Promise<void> {
  const pid = readHelperPid(lockDir);
  if (pid == null) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  // Wait briefly for it to exit.
  for (let i = 0; i < 30; i++) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 50));
    } catch {
      return;
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

export function makeHookInput(opts: {
  plan: string;
  permissionMode?: string;
  sessionId?: string;
  transcriptPath?: string;
}): string {
  return JSON.stringify({
    tool_input: { plan: opts.plan },
    permission_mode: opts.permissionMode ?? "default",
    session_id: opts.sessionId,
    transcript_path: opts.transcriptPath,
  });
}
