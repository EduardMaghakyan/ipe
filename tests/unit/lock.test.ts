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
  removeLockIfNonce,
  isProcessAlive,
  getLockDir,
} from "../../packages/server/lock";

const NONCE_A = "nonce-aaaaaaaa";
const NONCE_B = "nonce-bbbbbbbb";

describe("lock", () => {
  beforeEach(() => {
    removeLock();
    mkdirSync(testDir, { recursive: true });
  });

  test("getLockDir respects IPE_LOCK_DIR", () => {
    expect(getLockDir()).toBe(testDir);
  });

  test("readLock returns null when no lock file exists", () => {
    expect(readLock()).toBeNull();
  });

  test("writeLock creates a valid lock file with nonce and version", () => {
    writeLock({ port: 19450, nonce: NONCE_A, version: "1.2.3" });
    const lock = readLock();
    expect(lock).not.toBeNull();
    expect(lock!.pid).toBe(process.pid);
    expect(lock!.port).toBe(19450);
    expect(lock!.nonce).toBe(NONCE_A);
    expect(lock!.version).toBe("1.2.3");
    expect(typeof lock!.startedAt).toBe("number");
  });

  test("writeLock writes atomically via .tmp", () => {
    writeLock({ port: 19451, nonce: NONCE_A, version: "dev" });
    expect(existsSync(join(testDir, "server.lock.tmp"))).toBe(false);
    expect(existsSync(join(testDir, "server.lock"))).toBe(true);
  });

  test("removeLock deletes the lock file", () => {
    writeLock({ port: 19450, nonce: NONCE_A, version: "dev" });
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

  test("readLock rejects legacy locks without nonce/version", () => {
    writeFileSync(
      join(testDir, "server.lock"),
      JSON.stringify({ pid: process.pid, port: 19450, startedAt: Date.now() }),
    );
    expect(readLock()).toBeNull();
  });

  test("isProcessAlive returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("isProcessAlive returns false for non-existent PID", () => {
    expect(isProcessAlive(99999999)).toBe(false);
  });

  test("removeLockIfNonce unlinks when nonce matches", () => {
    writeLock({ port: 19450, nonce: NONCE_A, version: "dev" });
    expect(removeLockIfNonce(NONCE_A)).toBe(true);
    expect(readLock()).toBeNull();
  });

  test("removeLockIfNonce is a no-op when nonce differs", () => {
    writeLock({ port: 19450, nonce: NONCE_A, version: "dev" });
    expect(removeLockIfNonce(NONCE_B)).toBe(false);
    const lock = readLock();
    expect(lock).not.toBeNull();
    expect(lock!.nonce).toBe(NONCE_A);
  });

  test("removeLockIfNonce returns false when no lock exists", () => {
    expect(removeLockIfNonce(NONCE_A)).toBe(false);
  });
});

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true });
  } catch {
    // ignore
  }
});
