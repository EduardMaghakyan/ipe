export async function checkForUpdate(
  currentVersion: string,
): Promise<string | null> {
  if (currentVersion === "dev") return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(
      "https://api.github.com/repos/eduardmaghakyan/ipe/releases/latest",
      {
        signal: controller.signal,
        headers: { Accept: "application/vnd.github.v3+json" },
      },
    );

    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as { tag_name?: string };
    const latest = data.tag_name;

    if (!latest || latest === currentVersion) return null;

    return latest;
  } catch {
    return null;
  }
}
