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

export interface SessionDecision {
  behavior: "allow" | "deny";
  feedback: string;
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
  hookSSE: Set<ReadableStreamDefaultController>;
}

interface ServerOptions {
  port?: number;
  version?: string;
  latestVersion?: string;
  upgradeCommand?: string[];
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

export function startServer(options: ServerOptions = {}): {
  port: number;
  stop: () => void;
  addSession: (input: SessionInput) => Promise<SessionDecision>;
  waitForDrain: () => Promise<void>;
} {
  const sessions = new Map<string, SessionState>();
  const uiSSE = new Set<ReadableStreamDefaultController>();

  let drain: { promise: Promise<void>; resolve: () => void } | null = null;

  function waitForDrain(): Promise<void> {
    if (sessions.size === 0) return Promise.resolve();
    if (!drain) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      drain = { promise, resolve };
    }
    return drain.promise;
  }

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

    // Notify hook SSE listeners
    const msg = `event: decision\ndata: ${JSON.stringify(decision)}\n\n`;
    for (const ctrl of [...session.hookSSE]) {
      try {
        ctrl.enqueue(encoder.encode(msg));
        ctrl.close();
      } catch {
        // already closed
      }
    }

    session.resolve(decision);
    sessions.delete(sessionId);
    broadcastUI("session-removed", { sessionId });

    // Check if all sessions are done
    if (sessions.size === 0) {
      drain?.resolve();
      drain = null;
    }

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
        hookSSE: new Set(),
      };
      sessions.set(input.sessionId, state);
      broadcastUI("session-added", sessionToSummary(state));
    });
  }

  // Route matching helper for /api/sessions/:id/*
  function matchSessionRoute(
    pathname: string,
  ): { sessionId: string; action: string } | null {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/(.+)$/);
    if (m) return { sessionId: decodeURIComponent(m[1]), action: m[2] };
    return null;
  }

  const server = Bun.serve({
    port: options.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);

      // Serve UI
      if (req.method === "GET" && url.pathname === "/") {
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Health check
      if (req.method === "GET" && url.pathname === "/api/health") {
        return Response.json({
          ok: true,
          sessions: sessions.size,
          version: options.version || "dev",
          latestVersion: options.latestVersion,
        });
      }

      // List sessions
      if (req.method === "GET" && url.pathname === "/api/sessions") {
        const list = Array.from(sessions.values()).map(sessionToSummary);
        return Response.json(list);
      }

      // Register session
      if (req.method === "POST" && url.pathname === "/api/sessions") {
        return req
          .json()
          .then((body: SessionInput) => {
            addSession(body);
            return Response.json({ ok: true });
          })
          .catch(() =>
            Response.json({ error: "invalid request body" }, { status: 400 }),
          );
      }

      // UI SSE
      if (req.method === "GET" && url.pathname === "/api/events") {
        let ctrl: ReadableStreamDefaultController;
        const stream = new ReadableStream({
          start(controller) {
            ctrl = controller;
            uiSSE.add(controller);
            // Send current sessions as initial data
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

      // Session-specific routes
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
          let body: { feedback?: string };
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

        if (route.action === "events" && req.method === "GET") {
          if (!session) {
            return new Response("Session not found", { status: 404 });
          }
          let ctrl: ReadableStreamDefaultController;
          const stream = new ReadableStream({
            start(controller) {
              ctrl = controller;
              session.hookSSE.add(controller);
            },
            cancel() {
              session.hookSSE.delete(ctrl);
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
    stop: () => server.stop(),
    addSession,
    waitForDrain,
  };
}
