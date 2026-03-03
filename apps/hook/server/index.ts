import {
  startServer,
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
const DEFAULT_PORT = 19450;
const PORT_RANGE = 10;

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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function outputDecision(behavior: "allow" | "deny", message?: string): void {
  const decision: Record<string, unknown> = { behavior };
  if (behavior === "deny") {
    decision.message = message || "Plan changes requested";
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision,
    },
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}

function getBasePort(): number {
  const envPort = process.env.IPE_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_PORT;
}

function tryStartServer(
  port: number,
  version: string,
  latestVersion?: string,
): ReturnType<typeof startServer> | null {
  try {
    return startServer({ port, version, latestVersion });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : "";
    if (
      code === "EADDRINUSE" ||
      message.includes("EADDRINUSE") ||
      message.includes("address already in use")
    ) {
      return null;
    }
    throw err;
  }
}

async function isIPEServer(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean; version?: string };
    return data.ok === true;
  } catch {
    return false;
  }
}

async function findOrStartServer(
  version: string,
  latestVersion?: string,
): Promise<{
  server: ReturnType<typeof startServer> | null;
  port: number;
}> {
  const basePort = getBasePort();

  for (let i = 0; i < PORT_RANGE; i++) {
    const port = basePort + i;
    const server = tryStartServer(port, version, latestVersion);
    if (server) {
      return { server, port };
    }
    // Port taken — check if it's an IPE server we can join
    if (await isIPEServer(port)) {
      return { server: null, port };
    }
    // Port taken by something else — try next port
  }

  // All ports in range taken — fail
  console.error(
    `All ports ${basePort}-${basePort + PORT_RANGE - 1} are in use`,
  );
  process.exit(1);
}

async function waitForSSEDecision(
  port: number,
  sessionId: string,
): Promise<SessionDecision> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4 * 24 * 60 * 60 * 1000); // 4 days (matches hook timeout)

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

async function clientPath(
  port: number,
  sessionId: string,
  plan: string,
  permissionMode: string,
  previousPlans: Awaited<ReturnType<typeof loadHistory>>,
  fileSnippets: Awaited<ReturnType<typeof resolveSnippets>>,
): Promise<void> {
  const res = await fetch(`http://localhost:${port}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      plan,
      permissionMode,
      previousPlans,
      fileSnippets,
    }),
  });

  if (!res.ok) {
    console.error(`IPE: failed to register with server: ${res.status}`);
    outputDecision("deny", "Failed to register with IPE server. Please retry.");
    return;
  }

  console.error(
    `IPE ${VERSION} registered with server at http://localhost:${port}`,
  );

  try {
    const decision = await waitForSSEDecision(port, sessionId);
    outputDecision(decision.behavior, decision.feedback);
  } catch (err) {
    console.error(`IPE: lost connection to server: ${err}`);
    outputDecision(
      "deny",
      "IPE server disconnected before delivering decision. Please retry.",
    );
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

  // Save current plan version and load history
  saveVersion(sessionId, plan);
  const previousPlans = loadHistory(sessionId).filter((v) => v.plan !== plan);

  // Resolve file snippets referenced in the plan
  const cwd = input.cwd || process.cwd();
  const fileSnippets = await resolveSnippets(plan, cwd);

  const latestVersion = await checkForUpdate(VERSION);
  if (latestVersion) {
    console.error(
      `\nIPE ${latestVersion} is available (current: ${VERSION}). Upgrade: curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash\n`,
    );
  }

  const { server, port } = await findOrStartServer(
    VERSION,
    latestVersion || undefined,
  );

  if (server) {
    // We're the server owner
    const decisionPromise = server.addSession({
      sessionId,
      plan,
      permissionMode,
      previousPlans,
      fileSnippets,
    });

    const url = `http://localhost:${port}`;
    console.error(`IPE ${VERSION} running at ${url}`);
    openBrowser(url);

    const decision = await decisionPromise;
    outputDecision(decision.behavior, decision.feedback);

    await server.waitForDrain();
    // Grace period: allow in-flight SSE responses to be read by clients
    await new Promise((r) => setTimeout(r, 500));
    server.stop();
    setTimeout(() => process.exit(0), 50);
  } else {
    // Server already running — join as client
    await clientPath(
      port,
      sessionId,
      plan,
      permissionMode,
      previousPlans,
      fileSnippets,
    );
  }
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

  const { server, port } = await findOrStartServer(
    VERSION,
    latestVersion || undefined,
  );

  if (server) {
    const decisionPromise = server.addSession({
      sessionId,
      plan: "",
      permissionMode: "review",
      mode: "diff-review",
      fileDiffs,
      cwd,
    });

    const url = `http://localhost:${port}`;
    console.error(`IPE ${VERSION} running at ${url}`);
    openBrowser(url);

    const decision = await decisionPromise;
    outputDecision(decision.behavior, decision.feedback);

    await server.waitForDrain();
    await new Promise((r) => setTimeout(r, 500));
    server.stop();
    setTimeout(() => process.exit(0), 50);
  } else {
    await clientPath(port, sessionId, "", "review", [], []);
  }
}

// Route based on subcommand (argv differs between `bun run` and compiled binary)
const subcommand = process.argv.find((a) => a === "diff-review");
if (subcommand === "diff-review") {
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
