import html from "../ui/dist/index.html" with { type: "text" };
import type { PlanVersion } from "./history";

interface ServerOptions {
  plan: string;
  permissionMode: string;
  previousPlans?: PlanVersion[];
  onApprove: (feedback: string) => void;
  onDeny: (feedback: string) => void;
}

export function startServer(options: ServerOptions): {
  port: number;
  stop: () => void;
} {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
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
        });
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        return Response.json(options.previousPlans ?? []);
      }

      if (req.method === "POST" && url.pathname === "/api/approve") {
        return req.json().then((body: { feedback?: string }) => {
          options.onApprove(body.feedback || "");
          setTimeout(() => server.stop(), 100);
          return Response.json({ ok: true });
        });
      }

      if (req.method === "POST" && url.pathname === "/api/deny") {
        return req.json().then((body: { feedback?: string }) => {
          options.onDeny(body.feedback || "");
          setTimeout(() => server.stop(), 100);
          return Response.json({ ok: true });
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(),
  };
}
