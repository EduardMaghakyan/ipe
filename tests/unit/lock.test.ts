import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set IPE_LOCK_DIR before importing lock module
const testDir = mkdtempSync(join(tmpdir(), "ipe-lock-test-"));
process.env.IPE_LOCK_DIR = testDir;

import {
  readLock,
  writeLock,
  removeLock,
  isProcessAlive,
  isLockStale,
  getLockDir,
} from "../../packages/server/lock";

describe("lock", () => {
  beforeEach(() => {
    // Clean lock file between tests, ensure dir exists
    removeLock();
    mkdirSync(testDir, { recursive: true });
  });

  test("getLockDir respects IPE_LOCK_DIR", () => {
    expect(getLockDir()).toBe(testDir);
  });

  test("readLock returns null when no lock file exists", () => {
    expect(readLock()).toBeNull();
  });

  test("writeLock creates a valid lock file", () => {
    writeLock(19450);
    const lock = readLock();
    expect(lock).not.toBeNull();
    expect(lock!.pid).toBe(process.pid);
    expect(lock!.port).toBe(19450);
    expect(typeof lock!.startedAt).toBe("number");
  });

  test("writeLock writes atomically via .tmp", () => {
    writeLock(19451);
    // .tmp file should not remain
    expect(existsSync(join(testDir, "server.lock.tmp"))).toBe(false);
    expect(existsSync(join(testDir, "server.lock"))).toBe(true);
  });

  test("removeLock deletes the lock file", () => {
    writeLock(19450);
    expect(readLock()).not.toBeNull();
    removeLock();
    expect(readLock()).toBeNull();
  });

  test("removeLock is safe to call when no lock exists", () => {
    expect(() => removeLock()).not.toThrow();
  });

  test("readLock returns null for corrupt data", () => {
    writeFileSync(join(testDir, "server.lock"), "not json");
    expect(readLock()).toBeNull();
  });

  test("readLock returns null for missing fields", () => {
    writeFileSync(join(testDir, "server.lock"), JSON.stringify({ pid: 1 }));
    expect(readLock()).toBeNull();
  });

  test("isProcessAlive returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("isProcessAlive returns false for non-existent PID", () => {
    // PID 99999999 is extremely unlikely to exist
    expect(isProcessAlive(99999999)).toBe(false);
  });

  test("isLockStale returns true when no lock file exists", () => {
    expect(isLockStale()).toBe(true);
  });

  test("isLockStale returns false when lock belongs to current process", () => {
    writeLock(19450);
    expect(isLockStale()).toBe(false);
  });

  test("isLockStale returns true when lock PID is dead", () => {
    writeFileSync(
      join(testDir, "server.lock"),
      JSON.stringify({ pid: 99999999, port: 19450, startedAt: Date.now() }),
    );
    expect(isLockStale()).toBe(true);
  });
});

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true });
  } catch {
    // ignore
  }
});
