import html from "../ui/dist/index.html" with { type: "text" };
import type { PlanVersion } from "./history";

interface ServerOptions {
  plan: string;
  permissionMode: string;
  previousPlans?: PlanVersion[];
  version?: string;
  latestVersion?: string;
  upgradeCommand?: string[];
  onApprove: (feedback: string) => void;
  onDeny: (feedback: string) => void;
}

export function startServer(options: ServerOptions): {
  port: number;
  stop: () => void;
} {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/plan") {
        return Response.json({
          plan: options.plan,
          permissionMode: options.permissionMode,
          version: options.version || "dev",
          latestVersion: options.latestVersion,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        return Response.json(options.previousPlans ?? []);
      }

      const callbacks: Record<string, ((f: string) => void) | undefined> = {
        "/api/approve": options.onApprove,
        "/api/deny": options.onDeny,
      };
      const callback =
        req.method === "POST" ? callbacks[url.pathname] : undefined;
      if (callback) {
        return req.json().then((body: { feedback?: string }) => {
          callback(body.feedback || "");
          setTimeout(() => server.stop(), 100);
          return Response.json({ ok: true });
        });
      }

      if (req.method === "POST" && url.pathname === "/api/upgrade") {
        try {
          const cmd = options.upgradeCommand ?? [
            "bash",
            "-c",
            "curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash",
          ];
          const proc = Bun.spawn(cmd, {
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
          if (proc.exitCode === 0) {
            return Response.json({ ok: true });
          }
          const stderr = await new Response(proc.stderr).text();
          return Response.json({ ok: false, error: stderr }, { status: 500 });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(),
  };
}
