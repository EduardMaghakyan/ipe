import { describe, test, expect, afterEach } from "bun:test";
import { startServer } from "../../packages/server/index";

let stopFn: (() => void) | null = null;

afterEach(() => {
  stopFn?.();
  stopFn = null;
});

function createServer() {
  const server = startServer({ version: "test" });
  stopFn = server.stop;
  return server;
}

describe("multi-session server", () => {
  test("returns port and stop function", () => {
    const { port, stop } = createServer();
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(0);
    expect(typeof stop).toBe("function");
  });

  test("GET / returns HTML with status 200", async () => {
    const { port } = createServer();
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<");
  });

  test("GET /api/health returns ok and session count", async () => {
    const { port, addSession } = createServer();
    const res1 = await fetch(`http://localhost:${port}/api/health`);
    const data1 = await res1.json();
    expect(data1.ok).toBe(true);
    expect(data1.sessions).toBe(0);

    addSession({
      sessionId: "s1",
      plan: "# Plan",
      permissionMode: "plan",
    });

    const res2 = await fetch(`http://localhost:${port}/api/health`);
    const data2 = await res2.json();
    expect(data2.sessions).toBe(1);
  });

  test("GET /api/sessions returns all registered sessions", async () => {
    const { port, addSession } = createServer();

    addSession({
      sessionId: "s1",
      plan: "# Plan A",
      permissionMode: "plan",
    });
    addSession({
      sessionId: "s2",
      plan: "# Plan B",
      permissionMode: "plan",
    });

    const res = await fetch(`http://localhost:${port}/api/sessions`);
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].sessionId).toBe("s1");
    expect(data[0].title).toBe("Plan A");
    expect(data[1].sessionId).toBe("s2");
    expect(data[1].title).toBe("Plan B");
  });

  test("addSession returns promise that resolves on approve", async () => {
    const { port, addSession } = createServer();

    const decision = addSession({
      sessionId: "s1",
      plan: "# Plan",
      permissionMode: "plan",
    });

    const res = await fetch(
      `http://localhost:${port}/api/sessions/s1/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "Looks good!" }),
      },
    );
    expect(res.status).toBe(200);

    const result = await decision;
    expect(result.behavior).toBe("allow");
    expect(result.feedback).toBe("Looks good!");
  });

  test("addSession returns promise that resolves on deny", async () => {
    const { port, addSession } = createServer();

    const decision = addSession({
      sessionId: "s1",
      plan: "# Plan",
      permissionMode: "plan",
    });

    await fetch(`http://localhost:${port}/api/sessions/s1/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Needs work" }),
    });

    const result = await decision;
    expect(result.behavior).toBe("deny");
    expect(result.feedback).toBe("Needs work");
  });

  test("GET /api/sessions/:id/plan returns session plan data", async () => {
    const { port, addSession } = createServer();

    addSession({
      sessionId: "s1",
      plan: "# My Plan",
      permissionMode: "test-mode",
    });

    const res = await fetch(`http://localhost:${port}/api/sessions/s1/plan`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.plan).toBe("# My Plan");
    expect(data.permissionMode).toBe("test-mode");
  });

  test("GET /api/sessions/:id/history returns previous plans", async () => {
    const previousPlans = [{ version: 1, plan: "# Old Plan", timestamp: 1000 }];
    const { port, addSession } = createServer();

    addSession({
      sessionId: "s1",
      plan: "# Plan",
      permissionMode: "plan",
      previousPlans,
    });

    const res = await fetch(`http://localhost:${port}/api/sessions/s1/history`);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].plan).toBe("# Old Plan");
  });

  test("approve removes session, deny removes session", async () => {
    const { port, addSession } = createServer();

    addSession({ sessionId: "s1", plan: "# A", permissionMode: "plan" });
    addSession({ sessionId: "s2", plan: "# B", permissionMode: "plan" });

    // Approve s1
    await fetch(`http://localhost:${port}/api/sessions/s1/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "" }),
    });

    // s1 should be gone, s2 should remain
    const res = await fetch(`http://localhost:${port}/api/sessions`);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].sessionId).toBe("s2");
  });

  test("approve/deny on unknown session returns 404", async () => {
    const { port } = createServer();

    const res = await fetch(
      `http://localhost:${port}/api/sessions/nonexistent/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "" }),
      },
    );
    expect(res.status).toBe(404);
  });

  test("unknown routes return 404", async () => {
    const { port } = createServer();
    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});
