import { $ } from "bun";

export async function openBrowser(url: string): Promise<void> {
  const browser = process.env.IPE_BROWSER;

  if (browser) {
    await $`${browser} ${url}`.quiet();
    return;
  }

  switch (process.platform) {
    case "darwin":
      await $`open ${url}`.quiet();
      break;
    case "linux":
      await $`xdg-open ${url}`.quiet();
      break;
    case "win32":
      await $`cmd /c start ${url}`.quiet();
      break;
    default:
      console.error(`Cannot open browser on platform: ${process.platform}`);
  }
}
