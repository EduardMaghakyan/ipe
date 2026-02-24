import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function slugFromTranscript(transcriptPath: string): string | null {
  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trimEnd().split("\n");
    // Walk backwards — slug is on most lines, but be safe
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as { slug?: string };
        if (entry.slug) return entry.slug;
      } catch {
        continue;
      }
    }
  } catch {
    // transcript file unreadable
  }
  return null;
}

function getPlansDir(): string {
  return process.env.IPE_PLANS_DIR || join(homedir(), ".claude", "plans");
}

export function readPlanFromDisk(
  transcriptPath?: string,
  plansDir: string = getPlansDir(),
): string {
  // Tier 1: resolve via transcript slug
  if (transcriptPath) {
    const slug = slugFromTranscript(transcriptPath);
    if (slug) {
      const planPath = join(plansDir, `${slug}.md`);
      try {
        const content = readFileSync(planPath, "utf-8");
        if (content.trim()) {
          console.error(
            `IPE: tool_input.plan empty, reading from transcript slug → ${slug}.md`,
          );
          return content;
        }
      } catch {
        // slug file doesn't exist — fall through to tier 2
      }
    }
  }

  // Tier 2: most recently modified .md file
  try {
    const files = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
    if (files.length === 0) return "";

    const sorted = files
      .map((f) => ({
        name: f,
        mtime: statSync(join(plansDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    const content = readFileSync(join(plansDir, sorted[0].name), "utf-8");
    if (content.trim()) {
      console.error(
        `IPE: tool_input.plan empty, falling back to most recent plan file → ${sorted[0].name}`,
      );
      return content;
    }
  } catch {
    // plans directory doesn't exist or is unreadable
  }

  return "";
}
