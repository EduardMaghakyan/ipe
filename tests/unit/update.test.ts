import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { checkForUpdate } from "../../packages/server/update";

describe("checkForUpdate", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns null for "dev" version', async () => {
    expect(await checkForUpdate("dev")).toBeNull();
  });

  test("returns latest tag when different from current", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ tag_name: "v0.2.0" }), { status: 200 }),
      ),
    ) as typeof fetch;

    expect(await checkForUpdate("v0.1.0")).toBe("v0.2.0");
  });

  test("returns null when versions match", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ tag_name: "v0.1.0" }), { status: 200 }),
      ),
    ) as typeof fetch;

    expect(await checkForUpdate("v0.1.0")).toBeNull();
  });

  test("returns null on network error", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("network error")),
    ) as typeof fetch;

    expect(await checkForUpdate("v0.1.0")).toBeNull();
  });

  test("returns null on non-ok response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("rate limited", { status: 403 })),
    ) as typeof fetch;

    expect(await checkForUpdate("v0.1.0")).toBeNull();
  });

  test("returns null when tag_name is missing", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    ) as typeof fetch;

    expect(await checkForUpdate("v0.1.0")).toBeNull();
  });
});
