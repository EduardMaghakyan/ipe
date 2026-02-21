import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface PlanVersion {
  version: number;
  plan: string;
  timestamp: number;
}

function historyDir(sessionId: string): string {
  return join(homedir(), ".ipe", "history", sessionId);
}

export function loadHistory(sessionId: string): PlanVersion[] {
  const dir = historyDir(sessionId);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf-8")) as PlanVersion;
      } catch {
        return null;
      }
    })
    .filter((v): v is PlanVersion => v !== null);
}

export function saveVersion(sessionId: string, plan: string): PlanVersion {
  const dir = historyDir(sessionId);
  mkdirSync(dir, { recursive: true });

  const existing = loadHistory(sessionId);
  const version = existing.length + 1;
  const entry: PlanVersion = { version, plan, timestamp: Date.now() };

  writeFileSync(
    join(dir, `${String(version).padStart(4, "0")}.json`),
    JSON.stringify(entry),
  );

  return entry;
}
