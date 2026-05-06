const HOOK_ENTRY = `${process.cwd()}/apps/hook/server/index.ts`;

let nextPort = 19600;

export function nextUniquePort(): number {
  return nextPort++;
}

export interface SpawnedHook {
  proc: ReturnType<typeof Bun.spawn>;
  port: number;
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
}

export interface SpawnHookOptions {
  stdinData: string;
  port?: number;
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
      ...opts.extraEnv,
    },
  });
  return {
    proc,
    port,
    stdout: async () => new Response(proc.stdout).text(),
    stderr: async () => new Response(proc.stderr).text(),
  };
}

/**
 * Wait until the hook prints "IPE … listening on http://localhost:N".
 * Returns the port the in-process server bound to (may differ from IPE_PORT
 * if the env-supplied port was already in use).
 */
export async function waitForListening(
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
          `stderr stream ended before listening line. Buffer: ${buffer}`,
        );
      }
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/listening on http:\/\/localhost:(\d+)/);
      if (match) {
        return { port: parseInt(match[1], 10) };
      }
    }
    throw new Error(`Timed out waiting for listening line. Buffer: ${buffer}`);
  } finally {
    reader.releaseLock();
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
