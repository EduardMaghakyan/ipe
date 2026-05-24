import {
  startServer,
  type IPEServer,
  type SessionInput,
  type SessionDecision,
} from "../../../packages/server/index.ts";
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

const VERSION = "dev";
const STDIN_TIMEOUT_MS = Number(process.env.IPE_STDIN_TIMEOUT_MS) || 30_000;

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

async function readStdinWithTimeout(timeoutMs: number): Promise<string> {
  const chunks: Buffer[] = [];
  const reader = Bun.stdin.stream().getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("stdin read timeout")),
      timeoutMs,
    );
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
  } finally {
    clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Bootstrap signal handler: covers the window between process start and the
// moment runOneShotReview has wired session-aware handlers. Without this, a
// SIGTERM during stdin read or snippet resolution would default-kill the
// process and Claude Code would see an empty stdout.
function bootstrapSignalHandler(): void {
  outputDecision("deny", "IPE: hook canceled before review started");
  process.exit(0);
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

function startServerWithFallback(
  preferredPort: number | undefined,
  latestVersion: string | undefined,
): IPEServer {
  if (preferredPort !== undefined) {
    try {
      return startServer({
        port: preferredPort,
        version: VERSION,
        latestVersion,
      });
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code: string }).code
          : undefined;
      if (code === "EADDRINUSE") {
        console.error(
          `IPE: port ${preferredPort} in use, falling back to ephemeral port`,
        );
      } else {
        // Unknown error shape — log it and still fall back. Failing to fall
        // back means the user's plan gets denied because of a port issue,
        // which is worse UX than running on an OS-assigned port.
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `IPE: failed to bind preferred port ${preferredPort} (${message}); falling back to ephemeral port`,
        );
      }
    }
  }
  return startServer({ version: VERSION, latestVersion });
}

function getPreferredPort(): number | undefined {
  const envPort = process.env.IPE_PORT;
  if (!envPort) return undefined;
  const parsed = parseInt(envPort, 10);
  if (isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

async function runOneShotReview(
  input: SessionInput,
  latestVersion: string | undefined,
): Promise<SessionDecision> {
  const server = startServerWithFallback(getPreferredPort(), latestVersion);
  const decisionPromise = server.addSession(input);

  // We swap the bootstrap fallback handler (registered in main()) for one
  // that resolves the in-flight session as `deny`, so the await below
  // unblocks and the finally clause stops the server cleanly.
  process.off("SIGINT", bootstrapSignalHandler);
  process.off("SIGTERM", bootstrapSignalHandler);
  const onSignal = () => {
    server.resolveSession(input.sessionId, {
      behavior: "deny",
      feedback: "Hook canceled (parent process exited)",
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const url = `http://localhost:${server.port}`;
  console.error(
    `IPE ${VERSION} listening on ${url} (session=${input.sessionId})`,
  );
  openBrowser(url);

  try {
    return await decisionPromise;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    server.stop();
  }
}

async function main() {
  process.once("SIGINT", bootstrapSignalHandler);
  process.once("SIGTERM", bootstrapSignalHandler);

  let raw: string;
  try {
    raw = await readStdinWithTimeout(STDIN_TIMEOUT_MS);
  } catch (err) {
    console.error(`IPE: ${err}`);
    outputDecision("deny", "IPE: no input received from Claude Code");
    process.exit(1);
  }

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    console.error("IPE: failed to parse stdin JSON");
    outputDecision("deny", "IPE: invalid input JSON");
    process.exit(1);
  }

  const plan =
    input.tool_input?.plan || readPlanFromDisk(input.transcript_path);
  const permissionMode = input.permission_mode || "default";
  const sessionId = input.session_id || `anon-${Date.now()}`;

  console.error(`IPE: session=${sessionId} permissionMode=${permissionMode}`);

  if (!plan) {
    console.error("IPE: no plan found in stdin or on disk");
    outputDecision(
      "deny",
      "IPE could not find a plan. Ensure ~/.claude/plans/ contains a plan file.",
    );
    process.exit(1);
  }

  saveVersion(sessionId, plan);
  // history.ts skips duplicate writes, so the current plan only appears in
  // history if it's distinct from the prior version. Show the rest as
  // "previous" for the diff UI.
  const previousPlans = loadHistory(sessionId).slice(0, -1);

  const cwd = input.cwd || process.cwd();
  const fileSnippets = await resolveSnippets(plan, cwd);

  const latestVersion = (await checkForUpdate(VERSION)) || undefined;
  if (latestVersion) {
    console.error(
      `\nIPE ${latestVersion} is available (current: ${VERSION}). Upgrade: curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash\n`,
    );
  }

  const decision = await runOneShotReview(
    {
      sessionId,
      plan,
      permissionMode,
      previousPlans,
      fileSnippets,
    },
    latestVersion,
  );
  outputDecision(decision.behavior, decision.feedback, decision.acceptMode);
}

async function diffReviewMain() {
  process.once("SIGINT", bootstrapSignalHandler);
  process.once("SIGTERM", bootstrapSignalHandler);

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
  const latestVersion = (await checkForUpdate(VERSION)) || undefined;
  if (latestVersion) {
    console.error(
      `\nIPE ${latestVersion} is available (current: ${VERSION}). Upgrade: curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash\n`,
    );
  }

  const decision = await runOneShotReview(
    {
      sessionId,
      plan: "",
      permissionMode: "review",
      mode: "diff-review",
      fileDiffs,
      cwd,
    },
    latestVersion,
  );
  outputDecision(decision.behavior, decision.feedback, decision.acceptMode);
}

const subcommand = process.argv.find((a) => a === "diff-review");

if (subcommand === "diff-review") {
  diffReviewMain().catch((err) => {
    console.error("IPE fatal error:", err);
    outputDecision("deny", "IPE internal error. Please retry.");
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("IPE fatal error:", err);
    outputDecision("deny", "IPE internal error. Please retry.");
    process.exit(1);
  });
}
