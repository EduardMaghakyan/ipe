import { startServer } from "../../../packages/server/index.ts";
import { openBrowser } from "../../../packages/server/browser.ts";
import { loadHistory, saveVersion } from "../../../packages/server/history.ts";
import { checkForUpdate } from "../../../packages/server/update.ts";

const VERSION = "dev";

interface HookInput {
  tool_input: {
    plan?: string;
    [key: string]: unknown;
  };
  session_id?: string;
  permission_mode?: string;
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

async function main() {
  const raw = await readStdin();
  let input: HookInput;

  try {
    input = JSON.parse(raw);
  } catch {
    console.error("Failed to parse stdin JSON");
    process.exit(1);
  }

  const plan = input.tool_input?.plan || "";
  const permissionMode = input.permission_mode || "default";
  const sessionId = input.session_id || "";

  if (!plan) {
    console.error("No plan found in stdin input");
    process.exit(1);
  }

  // Save current plan version and load history
  let previousPlans: Awaited<ReturnType<typeof loadHistory>> = [];
  if (sessionId) {
    saveVersion(sessionId, plan);
    previousPlans = loadHistory(sessionId).filter((v) => v.plan !== plan);
  }

  const latestVersion = await checkForUpdate(VERSION);
  if (latestVersion) {
    console.error(
      `\nIPE ${latestVersion} is available (current: ${VERSION}). Upgrade: curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash\n`,
    );
  }

  const done = new Promise<void>((resolve) => {
    const { port } = startServer({
      plan,
      permissionMode,
      previousPlans,
      version: VERSION,
      latestVersion: latestVersion || undefined,
      onApprove(feedback: string) {
        outputDecision("allow", feedback);
        resolve();
      },
      onDeny(feedback: string) {
        outputDecision("deny", feedback);
        resolve();
      },
    });

    const url = `http://localhost:${port}`;
    console.error(`IPE ${VERSION} running at ${url}`);
    openBrowser(url);
  });

  await done;
}

main();
