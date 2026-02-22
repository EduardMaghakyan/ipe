import { describe, test, expect, afterEach } from "bun:test";
import { startServer } from "../../packages/server/index";

let stopFn: (() => void) | null = null;

afterEach(() => {
  stopFn?.();
  stopFn = null;
});

function createServer(
  overrides: Partial<Parameters<typeof startServer>[0]> = {},
) {
  const defaults = {
    plan: "# Test Plan\n\nSome content",
    permissionMode: "plan",
    onApprove: () => {},
    onDeny: () => {},
  };
  const { port, stop } = startServer({ ...defaults, ...overrides });
  stopFn = stop;
  return { port, stop };
}

describe("startServer", () => {
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

  test("GET /api/plan returns plan and permissionMode", async () => {
    const { port } = createServer({
      plan: "# My Plan",
      permissionMode: "test-mode",
    });
    const res = await fetch(`http://localhost:${port}/api/plan`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.plan).toBe("# My Plan");
    expect(data.permissionMode).toBe("test-mode");
  });

  test("POST /api/approve calls onApprove with feedback", async () => {
    let receivedFeedback: string | null = null;
    const { port } = createServer({
      onApprove: (feedback) => {
        receivedFeedback = feedback;
      },
    });

    const res = await fetch(`http://localhost:${port}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Looks good!" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(receivedFeedback).toBe("Looks good!");
  });

  test("POST /api/deny calls onDeny with feedback", async () => {
    let receivedFeedback: string | null = null;
    const { port } = createServer({
      onDeny: (feedback) => {
        receivedFeedback = feedback;
      },
    });

    const res = await fetch(`http://localhost:${port}/api/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "Needs changes" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(receivedFeedback).toBe("Needs changes");
  });

  test("POST /api/approve with empty feedback defaults to empty string", async () => {
    let receivedFeedback: string | null = null;
    const { port } = createServer({
      onApprove: (feedback) => {
        receivedFeedback = feedback;
      },
    });

    await fetch(`http://localhost:${port}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(receivedFeedback).toBe("");
  });

  test("unknown routes return 404", async () => {
    const { port } = createServer();
    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  test("GET /api/history returns empty array when no previous plans", async () => {
    const { port } = createServer();
    const res = await fetch(`http://localhost:${port}/api/history`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("GET /api/history returns previous plans when provided", async () => {
    const previousPlans = [
      { version: 1, plan: "# Old Plan", timestamp: 1000 },
      { version: 2, plan: "# Updated Plan", timestamp: 2000 },
    ];
    const { port } = createServer({ previousPlans });
    const res = await fetch(`http://localhost:${port}/api/history`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].version).toBe(1);
    expect(data[1].plan).toBe("# Updated Plan");
  });

  test("GET /api/plan returns latestVersion when provided", async () => {
    const { port } = createServer({
      version: "v0.1.2",
      latestVersion: "v0.2.0",
    });
    const res = await fetch(`http://localhost:${port}/api/plan`);
    const data = await res.json();
    expect(data.version).toBe("v0.1.2");
    expect(data.latestVersion).toBe("v0.2.0");
  });

  test("GET /api/plan omits latestVersion when not provided", async () => {
    const { port } = createServer();
    const res = await fetch(`http://localhost:${port}/api/plan`);
    const data = await res.json();
    expect(data.latestVersion).toBeUndefined();
  });

  test("POST /api/upgrade returns success on exit code 0", async () => {
    const { port } = createServer({ upgradeCommand: ["true"] });
    const res = await fetch(`http://localhost:${port}/api/upgrade`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("POST /api/upgrade returns error on non-zero exit", async () => {
    const { port } = createServer({ upgradeCommand: ["false"] });
    const res = await fetch(`http://localhost:${port}/api/upgrade`, {
      method: "POST",
    });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});
