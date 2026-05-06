import html from "../ui/dist/index.html" with { type: "text" };
import type { PlanVersion } from "./history";
import type { FileSnippet } from "./snippets";
import type { FileDiff, DiffMode } from "./git-diff";
import { runGitDiff, parseUnifiedDiff } from "./git-diff";

const encoder = new TextEncoder();

export interface SessionInput {
  sessionId: string;
  plan: string;
  permissionMode: string;
  previousPlans?: PlanVersion[];
  fileSnippets?: FileSnippet[];
  mode?: "plan" | "diff-review";
  fileDiffs?: FileDiff[];
  cwd?: string;
}

export type AcceptMode = "normal" | "auto-approve";

export interface SessionDecision {
  behavior: "allow" | "deny";
  feedback: string;
  acceptMode?: AcceptMode;
}

interface SessionState {
  sessionId: string;
  plan: string;
  permissionMode: string;
  previousPlans: PlanVersion[];
  fileSnippets: FileSnippet[];
  mode: "plan" | "diff-review";
  fileDiffs: FileDiff[];
  cwd?: string;
  registeredAt: number;
  resolve: (decision: SessionDecision) => void;
}

interface ServerOptions {
  port?: number;
  version?: string;
  latestVersion?: string;
  upgradeCommand?: string[];
}

export interface IPEServer {
  port: number;
  stop: (force?: boolean) => void;
  addSession: (input: SessionInput) => Promise<SessionDecision>;
  resolveSession: (sessionId: string, decision: SessionDecision) => boolean;
  hasSession: (sessionId: string) => boolean;
}

function extractTitle(plan: string): string {
  const match = plan.match(/^#{1,2}\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled Plan";
}

function sessionToSummary(s: SessionState) {
  return {
    sessionId: s.sessionId,
    title: s.mode === "diff-review" ? "Diff Review" : extractTitle(s.plan),
    plan: s.plan,
    permissionMode: s.permissionMode,
    previousPlans: s.previousPlans,
    fileSnippets: s.fileSnippets,
    mode: s.mode,
    fileDiffs: s.fileDiffs,
    registeredAt: s.registeredAt,
  };
}

export function startServer(options: ServerOptions = {}): IPEServer {
  const sessions = new Map<string, SessionState>();
  const uiSSE = new Set<ReadableStreamDefaultController>();

  function broadcastUI(event: string, data: unknown) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const ctrl of [...uiSSE]) {
      try {
        ctrl.enqueue(encoder.encode(msg));
      } catch {
        uiSSE.delete(ctrl);
      }
    }
  }

  function resolveSession(
    sessionId: string,
    decision: SessionDecision,
  ): boolean {
    const session = sessions.get(sessionId);
    if (!session) return false;
    sessions.delete(sessionId);
    broadcastUI("session-removed", { sessionId });
    // Defer the in-process Promise resolution by one tick so the HTTP
    // response that triggered this call has time to flush before the
    // hook's main await unblocks and force-stops the server.
    setTimeout(() => session.resolve(decision), 0);
    return true;
  }

  function addSession(input: SessionInput): Promise<SessionDecision> {
    return new Promise<SessionDecision>((resolve) => {
      const state: SessionState = {
        sessionId: input.sessionId,
        plan: input.plan,
        permissionMode: input.permissionMode,
        previousPlans: input.previousPlans ?? [],
        fileSnippets: input.fileSnippets ?? [],
        mode: input.mode ?? "plan",
        fileDiffs: input.fileDiffs ?? [],
        cwd: input.cwd,
        registeredAt: Date.now(),
        resolve,
      };
      sessions.set(input.sessionId, state);
      broadcastUI("session-added", sessionToSummary(state));
    });
  }

  function matchSessionRoute(
    pathname: string,
  ): { sessionId: string; action: string } | null {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/(.+)$/);
    if (!m) return null;
    try {
      return { sessionId: decodeURIComponent(m[1]), action: m[2] };
    } catch {
      // Malformed percent-encoding — caller will return 404 (no match)
      return null;
    }
  }

  const server = Bun.serve({
    port: options.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        return Response.json({
          ok: true,
          sessions: sessions.size,
          version: options.version || "dev",
          latestVersion: options.latestVersion,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/sessions") {
        const list = Array.from(sessions.values()).map(sessionToSummary);
        return Response.json(list);
      }

      if (req.method === "POST" && url.pathname === "/api/sessions") {
        let body: SessionInput;
        try {
          body = (await req.json()) as SessionInput;
        } catch {
          return Response.json(
            { error: "invalid request body" },
            { status: 400 },
          );
        }
        if (!body.sessionId) {
          return Response.json(
            { error: "sessionId required" },
            { status: 400 },
          );
        }
        if (sessions.has(body.sessionId)) {
          return Response.json({ ok: true, deduped: true });
        }
        addSession(body);
        return Response.json({ ok: true });
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        let ctrl: ReadableStreamDefaultController;
        const stream = new ReadableStream({
          start(controller) {
            ctrl = controller;
            uiSSE.add(controller);
            const list = Array.from(sessions.values()).map(sessionToSummary);
            const msg = `event: init\ndata: ${JSON.stringify(list)}\n\n`;
            controller.enqueue(encoder.encode(msg));
          },
          cancel() {
            uiSSE.delete(ctrl);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      const route = matchSessionRoute(url.pathname);
      if (route) {
        const session = sessions.get(route.sessionId);

        if (route.action === "plan" && req.method === "GET") {
          if (!session)
            return Response.json({ error: "not found" }, { status: 404 });
          return Response.json({
            plan: session.plan,
            permissionMode: session.permissionMode,
            version: options.version || "dev",
          });
        }

        if (route.action === "history" && req.method === "GET") {
          if (!session)
            return Response.json({ error: "not found" }, { status: 404 });
          return Response.json(session.previousPlans);
        }

        if (
          (route.action === "approve" || route.action === "deny") &&
          req.method === "POST"
        ) {
          let body: { feedback?: string; acceptMode?: AcceptMode };
          try {
            body = await req.json();
          } catch {
            return Response.json(
              { error: "invalid request body" },
              { status: 400 },
            );
          }
          try {
            const behavior = route.action === "approve" ? "allow" : "deny";
            const ok = resolveSession(route.sessionId, {
              behavior,
              feedback: body.feedback || "",
              acceptMode: behavior === "allow" ? body.acceptMode : undefined,
            });
            if (!ok)
              return Response.json({ error: "not found" }, { status: 404 });
            return Response.json({ ok: true });
          } catch (err) {
            console.error("IPE: error resolving session:", err);
            return Response.json({ error: "internal error" }, { status: 500 });
          }
        }

        if (route.action === "refresh-diff" && req.method === "POST") {
          if (!session || session.mode !== "diff-review" || !session.cwd) {
            return Response.json({ error: "not found" }, { status: 404 });
          }
          let body: { mode?: DiffMode };
          try {
            body = await req.json();
          } catch {
            return Response.json(
              { error: "invalid request body" },
              { status: 400 },
            );
          }
          const validModes: DiffMode[] = ["unstaged", "staged", "all"];
          if (body.mode && !validModes.includes(body.mode)) {
            return Response.json(
              { error: `invalid mode: ${body.mode}` },
              { status: 400 },
            );
          }
          try {
            const diffMode = body.mode ?? "unstaged";
            const raw = await runGitDiff(session.cwd, diffMode);
            const fileDiffs = parseUnifiedDiff(raw);
            session.fileDiffs = fileDiffs;
            return Response.json({ ok: true, fileDiffs });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return Response.json(
              { ok: false, error: message },
              { status: 500 },
            );
          }
        }
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
            options.latestVersion = undefined;
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
    // Default to force-closing active connections — without this, long-lived
    // SSE clients (browser tab still open) keep the event loop alive and
    // the hook process would hang indefinitely after writing its decision.
    stop: (force = true) => server.stop(force),
    addSession,
    resolveSession,
    hasSession: (sessionId: string) => sessions.has(sessionId),
  };
}
