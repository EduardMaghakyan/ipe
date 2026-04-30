import { startServer } from "../../../packages/server/index.ts";
import { checkForUpdate } from "../../../packages/server/update.ts";
import {
  readLock,
  writeLock,
  removeLockIfNonce,
  isProcessAlive,
} from "../../../packages/server/lock.ts";

const DEFAULT_PORT = 19450;
const PORT_RANGE = 10;
const SHUTDOWN_DRAIN_CAP_MS = 5000;

interface ServeOptions {
  version: string;
}

function getBasePort(): number {
  const envPort = process.env.IPE_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_PORT;
}

function generateNonce(): string {
  return crypto.randomUUID();
}

function tryStartServer(
  port: number,
  nonce: string,
  version: string,
  latestVersion: string | undefined,
  onShutdownRequest: () => void,
): ReturnType<typeof startServer> | null {
  try {
    return startServer({
      port,
      version,
      latestVersion,
      nonce,
      onShutdownRequest,
    });
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

export async function serveMain(options: ServeOptions): Promise<void> {
  // Refuse to boot if a healthy helper already owns the lock — another
  // helper raced us to start. Bail without writing anything.
  const existing = readLock();
  if (
    existing &&
    isProcessAlive(existing.pid) &&
    existing.pid !== process.pid
  ) {
    console.error(
      `IPE serve: lock held by pid=${existing.pid} on port=${existing.port}; exiting.`,
    );
    return;
  }

  const basePort = getBasePort();
  const nonce = generateNonce();

  // Look up latest version once at boot so the UI's upgrade banner has data.
  const latestVersion = (await checkForUpdate(options.version)) || undefined;

  let server: ReturnType<typeof startServer> | null = null;
  let chosenPort = -1;

  for (let i = 0; i < PORT_RANGE; i++) {
    const port = basePort + i;
    const candidate = tryStartServer(
      port,
      nonce,
      options.version,
      latestVersion,
      () => {
        // /api/shutdown handler — initiate graceful exit.
        void shutdown("shutdown-request");
      },
    );
    if (candidate) {
      server = candidate;
      chosenPort = port;
      break;
    }
  }

  if (!server) {
    console.error(
      `IPE serve: all ports ${basePort}-${basePort + PORT_RANGE - 1} are in use`,
    );
    process.exit(1);
  }

  writeLock({ port: chosenPort, nonce, version: options.version });
  console.error(
    `IPE serve: ready pid=${process.pid} port=${chosenPort} nonce=${nonce.slice(0, 8)} version=${options.version}`,
  );

  let shuttingDown = false;
  async function shutdown(reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`IPE serve: draining (${reason})`);
    server!.setDraining(true);
    const drainStart = Date.now();
    const drainTimer = setTimeout(() => {
      console.error("IPE serve: drain cap reached, forcing exit");
    }, SHUTDOWN_DRAIN_CAP_MS);
    try {
      await Promise.race([
        server!.waitForDrain(),
        new Promise<void>((r) => setTimeout(r, SHUTDOWN_DRAIN_CAP_MS)),
      ]);
    } finally {
      clearTimeout(drainTimer);
    }
    server!.stop();
    removeLockIfNonce(nonce);
    console.error(
      `IPE serve: stopped after ${Date.now() - drainStart}ms drain`,
    );
    process.exit(0);
  }

  const onSignal = (sig: string) => () => {
    void shutdown(sig);
  };
  process.on("SIGTERM", onSignal("SIGTERM"));
  if (process.platform !== "win32") {
    process.on("SIGINT", onSignal("SIGINT"));
  }

  // Keep the process alive — Bun.serve does this on its own, but make it
  // explicit so future refactors don't accidentally exit.
  return new Promise(() => {});
}
