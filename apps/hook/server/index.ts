import { startServer } from "../../../packages/server/index.ts";
import { openBrowser } from "../../../packages/server/browser.ts";

interface HookInput {
  tool_input: {
    plan?: string;
    [key: string]: unknown;
  };
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

function outputAllow(feedback: string): void {
  const output: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}

function outputDeny(feedback: string): void {
  const message = feedback || "Plan changes requested";
  const output = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "deny",
        message,
      },
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

  if (!plan) {
    console.error("No plan found in stdin input");
    process.exit(1);
  }

  const done = new Promise<void>((resolve) => {
    const { port } = startServer({
      plan,
      permissionMode,
      onApprove(feedback: string) {
        outputAllow(feedback);
        resolve();
      },
      onDeny(feedback: string) {
        outputDeny(feedback);
        resolve();
      },
    });

    const url = `http://localhost:${port}`;
    console.error(`IPE server running at ${url}`);
    openBrowser(url);
  });

  await done;
}

main();
