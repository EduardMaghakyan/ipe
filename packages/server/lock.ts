import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readFileSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

export interface LockData {
  pid: number;
  port: number;
  startedAt: number;
}

const LOCK_FILENAME = "server.lock";

export function getLockDir(): string {
  return process.env.IPE_LOCK_DIR || join(homedir(), ".ipe");
}

function lockPath(): string {
  return join(getLockDir(), LOCK_FILENAME);
}

export function readLock(): LockData | null {
  try {
    const raw = readFileSync(lockPath(), "utf-8");
    const data = JSON.parse(raw);
    if (
      typeof data.pid === "number" &&
      typeof data.port === "number" &&
      typeof data.startedAt === "number"
    ) {
      return data as LockData;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeLock(port: number): void {
  const dir = getLockDir();
  mkdirSync(dir, { recursive: true });
  const data: LockData = {
    pid: process.pid,
    port,
    startedAt: Date.now(),
  };
  const path = lockPath();
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

export function removeLock(): void {
  try {
    unlinkSync(lockPath());
  } catch {
    // ignore ENOENT
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isLockStale(): boolean {
  const lock = readLock();
  if (!lock) return true;
  return !isProcessAlive(lock.pid);
}
