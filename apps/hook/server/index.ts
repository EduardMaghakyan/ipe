import { type SessionDecision } from "../../../packages/server/index.ts";
import { openBrowser } from "../../../packages/server/browser.ts";
import { loadHistory, saveVersion } from "../../../packages/server/history.ts";
import { checkForUpdate } from "../../../packages/server/update.ts";
import { resolveSnippets } from "../../../packages/server/snippets.ts";
import { readPlanFromDisk } from "../../../packages/server/plan-file.ts";
import {
  runGitDiff,
  parseUnifiedDiff,
  type DiffMode,
} from "../../../packages/server/git-diff.ts";
import {
  readLock,
  isProcessAlive,
  removeLock,
} from "../../../packages/server/lock.ts";
import { serveMain } from "./serve.ts";

const VERSION = "dev";
const HEALTH_TIMEOUT_MS = 1000;
const HELPER_READY_TIMEOUT_MS = 3000;
const HELPER_POLL_INTERVAL_MS = 100;
const POST_RETRY_BACKOFF_MS = [100, 300, 900];

interface HookInput {
  tool_input: {
    plan?: string;
    [key: string]: unknown;
  };
  session_id?: string;
  permission_mode?: string;
  cwd?: string;
  transcript_path?: string;
  [key: string]: unknown;
}

interface HelperEndpoint {
  port: number;
  nonce: string;
  version: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function outputDecision(
  behavior: "allow" | "deny",
  message?: string,
  acceptMode?: string,
): void {
  const decision: Record<string, unknown> = { behavior };
  if (behavior === "deny") {
    decision.message = message || "Plan changes requested";
  }
  if (behavior === "allow" && acceptMode === "auto-approve") {
    decision.updatedPermissions = [
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ];
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision,
    },
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}

interface HealthResponse {
  ok: boolean;
  version?: string;
  nonce?: string;
  draining?: boolean;
}

async function fetchHealth(port: number): Promise<HealthResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as HealthResponse;
    if (data?.ok !== true) return null;
    return data;
  } catch {
    return null;
  }
}

function helperSpawnArgs(): string[] {
  // process.execPath is always the real on-disk binary path (bun in dev,
  // the compiled `ipe` binary in production). process.argv[1], when it
  // looks like a script file, signals dev mode and must be re-passed.
  const argv1 = process.argv[1] || "";
  const looksLikeScript =
    argv1.endsWith(".ts") || argv1.endsWith(".js") || argv1.endsWith(".mjs");
  if (looksLikeScript) {
    return [process.execPath, argv1, "serve"];
  }
  return [process.execPath, "serve"];
}

function spawnHelper(): void {
  const args = helperSpawnArgs();
  const child = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: process.env as Record<string, string>,
  });
  // Detach: don't keep parent alive waiting on child.
  child.unref?.();
}

async function waitForHelperReady(): Promise<HelperEndpoint | null> {
  const deadline = Date.now() + HELPER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lock = readLock();
    if (lock && isProcessAlive(lock.pid)) {
      const health = await fetchHealth(lock.port);
      if (health && health.nonce === lock.nonce) {
        return {
          port: lock.port,
          nonce: lock.nonce,
          version: health.version || lock.version,
        };
      }
    }
    await new Promise((r) => setTimeout(r, HELPER_POLL_INTERVAL_MS));
  }
  return null;
}

async function findOrSpawnHelper(): Promise<HelperEndpoint> {
  // Try existing helper first.
  const lock = readLock();
  if (lock && isProcessAlive(lock.pid)) {
    const health = await fetchHealth(lock.port);
    if (health && health.nonce === lock.nonce) {
      return {
        port: lock.port,
        nonce: lock.nonce,
        version: health.version || lock.version,
      };
    }
    // Lock points to live PID but health/nonce mismatch — stale. Clean up.
    removeLock();
  } else if (lock) {
    // Dead PID lock — clean up.
    removeLock();
  }

  spawnHelper();
  const ready = await waitForHelperReady();
  if (!ready) {
    throw new Error("IPE helper did not become ready in time");
  }
  return ready;
}

async function ensureHelperVersion(
  endpoint: HelperEndpoint,
): Promise<HelperEndpoint> {
  if (endpoint.version === VERSION || VERSION === "dev") {
    return endpoint;
  }
  console.error(
    `IPE: helper version=${endpoint.version} differs from hook=${VERSION}, restarting helper`,
  );
  try {
    await fetch(`http://localhost:${endpoint.port}/api/shutdown`, {
      method: "POST",
    });
  } catch {
    // ignore — helper might already be exiting
  }
  // Wait for the helper to release the lock, then spawn fresh.
  const deadline = Date.now() + HELPER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lock = readLock();
    if (!lock || lock.nonce !== endpoint.nonce) break;
    await new Promise((r) => setTimeout(r, HELPER_POLL_INTERVAL_MS));
  }
  return findOrSpawnHelper();
}

interface PostResult {
  status: "registered" | "deduped" | "replayed";
  decision?: SessionDecision;
}

async function postSession(
  port: number,
  body: Record<string, unknown>,
): Promise<{ ok: true; result: PostResult } | { ok: false; status?: number }> {
  let res: Response;
  try {
    res = await fetch(`http://localhost:${port}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as {
    ok?: boolean;
    deduped?: boolean;
    replayed?: boolean;
    decision?: SessionDecision;
  };
  if (data.replayed && data.decision) {
    return {
      ok: true,
      result: { status: "replayed", decision: data.decision },
    };
  }
  if (data.deduped) {
    return { ok: true, result: { status: "deduped" } };
  }
  return { ok: true, result: { status: "registered" } };
}

async function registerSession(
  body: Record<string, unknown>,
): Promise<{ endpoint: HelperEndpoint; result: PostResult }> {
  let endpoint = await findOrSpawnHelper();
  endpoint = await ensureHelperVersion(endpoint);

  for (let attempt = 0; attempt < POST_RETRY_BACKOFF_MS.length; attempt++) {
    const post = await postSession(endpoint.port, body);
    if (post.ok) {
      return { endpoint, result: post.result };
    }
    // 503 → helper draining; respawn and retry.
    // network error → helper died; respawn and retry.
    await new Promise((r) =>
      setTimeout(r, POST_RETRY_BACKOFF_MS[attempt] || 900),
    );
    endpoint = await findOrSpawnHelper();
  }
  throw new Error("Failed to register session with IPE helper after retries");
}

async function waitForSSEDecision(
  port: number,
  sessionId: string,
): Promise<SessionDecision> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4 * 24 * 60 * 60 * 1000);
  try {
    const res = await fetch(
      `http://localhost:${port}/api/sessions/${encodeURIComponent(sessionId)}/events`,
      { signal: controller.signal },
    );
    if (!res.ok || !res.body) {
      throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE stream ended without decision");
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              return JSON.parse(data) as SessionDecision;
            } catch {
              // not the event we're looking for
            }
          }
        }
        buffer = lines[lines.length - 1];
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeout);
  }
}

function registerCancel(port: number, sessionId: string): () => void {
  let canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    try {
      // Fire-and-forget; we're about to exit anyway.
      void fetch(
        `http://localhost:${port}/api/sessions/${encodeURIComponent(sessionId)}/cancel`,
        { method: "POST" },
      );
    } catch {
      // ignore
    }
  };
  const onSignal = () => {
    cancel();
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return cancel;
}

async function runReviewSession(body: {
  sessionId: string;
  plan: string;
  permissionMode: string;
  previousPlans?: unknown;
  fileSnippets?: unknown;
  mode?: string;
  fileDiffs?: unknown;
  cwd?: string;
}): Promise<void> {
  const { endpoint, result } = await registerSession(body);

  // If the helper replayed a recent decision, we're done immediately.
  if (result.status === "replayed" && result.decision) {
    outputDecision(
      result.decision.behavior,
      result.decision.feedback,
      result.decision.acceptMode,
    );
    return;
  }

  const url = `http://localhost:${endpoint.port}`;
  console.error(
    `IPE ${VERSION} registered with helper at ${url} (status=${result.status})`,
  );
  openBrowser(url);
  registerCancel(endpoint.port, body.sessionId);

  try {
    const decision = await waitForSSEDecision(endpoint.port, body.sessionId);
    outputDecision(decision.behavior, decision.feedback, decision.acceptMode);
  } catch (err) {
    // SSE dropped mid-wait. Re-register against (possibly fresh) helper —
    // the POST is idempotent and the recentDecisions cache will replay if
    // the session resolved during the gap.
    console.error(`IPE: SSE dropped (${err}); reattaching`);
    const retry = await registerSession(body);
    if (retry.result.status === "replayed" && retry.result.decision) {
      outputDecision(
        retry.result.decision.behavior,
        retry.result.decision.feedback,
        retry.result.decision.acceptMode,
      );
      return;
    }
    try {
      const decision = await waitForSSEDecision(
        retry.endpoint.port,
        body.sessionId,
      );
      outputDecision(decision.behavior, decision.feedback, decision.acceptMode);
    } catch (err2) {
      console.error(`IPE: lost connection to helper after retry: ${err2}`);
      outputDecision(
        "deny",
        "IPE helper disconnected before delivering decision. Please retry.",
      );
    }
  }
}

async function main() {
  const raw = await readStdin();
  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    console.error("Failed to parse stdin JSON");
    process.exit(1);
  }

  const plan =
    input.tool_input?.plan || readPlanFromDisk(input.transcript_path);
  const permissionMode = input.permission_mode || "default";
  const sessionId = input.session_id || `anon-${Date.now()}`;

  console.error(`IPE: session=${sessionId} permissionMode=${permissionMode}`);

  if (!plan) {
    console.error("No plan found in stdin input or on disk");
    outputDecision(
      "deny",
      "IPE could not find a plan. Ensure ~/.claude/plans/ contains a plan file.",
    );
    process.exit(1);
  }

  saveVersion(sessionId, plan);
  const previousPlans = loadHistory(sessionId).filter((v) => v.plan !== plan);

  const cwd = input.cwd || process.cwd();
  const fileSnippets = await resolveSnippets(plan, cwd);

  const latestVersion = await checkForUpdate(VERSION);
  if (latestVersion) {
    console.error(
      `\nIPE ${latestVersion} is available (current: ${VERSION}). Upgrade: curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash\n`,
    );
  }

  await runReviewSession({
    sessionId,
    plan,
    permissionMode,
    previousPlans,
    fileSnippets,
  });
}

async function diffReviewMain() {
  const drIdx = process.argv.indexOf("diff-review");
  const args = drIdx >= 0 ? process.argv.slice(drIdx + 1) : [];
  let diffMode: DiffMode = "unstaged";
  if (args.includes("--staged")) diffMode = "staged";
  else if (args.includes("--all")) diffMode = "all";

  const cwd = process.cwd();
  console.error(`IPE diff-review: mode=${diffMode} cwd=${cwd}`);

  let raw: string;
  try {
    raw = await runGitDiff(cwd, diffMode);
  } catch (err) {
    console.error(`IPE: git diff failed: ${err}`);
    outputDecision("deny", `git diff failed: ${err}`);
    process.exit(1);
  }

  const fileDiffs = parseUnifiedDiff(raw);
  if (fileDiffs.length === 0) {
    console.error("No changes to review.");
    process.exit(0);
  }
  console.error(`IPE: ${fileDiffs.length} file(s) changed`);

  const sessionId = `review-${Date.now()}`;
  const latestVersion = await checkForUpdate(VERSION);
  if (latestVersion) {
    console.error(
      `\nIPE ${latestVersion} is available (current: ${VERSION}). Upgrade: curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash\n`,
    );
  }

  await runReviewSession({
    sessionId,
    plan: "",
    permissionMode: "review",
    mode: "diff-review",
    fileDiffs,
    cwd,
  });
}

const subcommand = process.argv.find(
  (a) => a === "diff-review" || a === "serve",
);

if (subcommand === "serve") {
  serveMain({ version: VERSION }).catch((err) => {
    console.error("IPE serve fatal error:", err);
    process.exit(1);
  });
} else if (subcommand === "diff-review") {
  diffReviewMain().catch((err) => {
    console.error("IPE fatal error:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("IPE fatal error:", err);
    outputDecision("deny", "IPE internal error. Please retry.");
    process.exit(1);
  });
}
