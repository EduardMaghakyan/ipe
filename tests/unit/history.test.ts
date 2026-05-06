import { describe, test, expect, afterEach } from "bun:test";
import { saveVersion, loadHistory } from "../../packages/server/history";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const usedSessions = new Set<string>();

function uniqSession(label: string): string {
  const id = `ipe-test-history-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  usedSessions.add(id);
  return id;
}

afterEach(() => {
  for (const sid of usedSessions) {
    try {
      rmSync(join(homedir(), ".ipe", "history", sid), { recursive: true });
    } catch {}
  }
  usedSessions.clear();
});

describe("history dedupe", () => {
  test("saveVersion writes a new file for a new plan", () => {
    const sid = uniqSession("fresh");
    const v = saveVersion(sid, "# Plan A");
    expect(v.version).toBe(1);
    expect(loadHistory(sid)).toHaveLength(1);
  });

  test("saveVersion does not duplicate identical consecutive plans", () => {
    const sid = uniqSession("dedupe");
    const a = saveVersion(sid, "# Plan A");
    const b = saveVersion(sid, "# Plan A");
    expect(b.version).toBe(a.version);
    expect(b.timestamp).toBe(a.timestamp);
    expect(loadHistory(sid)).toHaveLength(1);
  });

  test("saveVersion writes a new version when the plan actually changes", () => {
    const sid = uniqSession("changes");
    saveVersion(sid, "# Plan A");
    saveVersion(sid, "# Plan A"); // dedupe — no-op
    saveVersion(sid, "# Plan B");
    saveVersion(sid, "# Plan B"); // dedupe — no-op
    saveVersion(sid, "# Plan C");
    const versions = loadHistory(sid);
    expect(versions.map((v) => v.plan)).toEqual([
      "# Plan A",
      "# Plan B",
      "# Plan C",
    ]);
  });
});
