export function openBrowser(url: string): void {
  const browser = process.env.IPE_BROWSER;

  let cmd: string[];
  if (browser) {
    // Split on whitespace so users can pass flags
    // (e.g. IPE_BROWSER="firefox --new-window"). No shell expansion —
    // paths-with-spaces are not supported via this env var.
    const argv = browser.split(/\s+/).filter(Boolean);
    if (argv.length === 0) {
      console.error("IPE: IPE_BROWSER is set but empty after trim");
      return;
    }
    cmd = [...argv, url];
  } else {
    switch (process.platform) {
      case "darwin":
        cmd = ["open", url];
        break;
      case "linux":
        cmd = ["xdg-open", url];
        break;
      case "win32":
        cmd = ["cmd", "/c", "start", "", url];
        break;
      default:
        console.error(
          `IPE: cannot open browser on platform ${process.platform}`,
        );
        return;
    }
  }

  try {
    const child = Bun.spawn(cmd, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    child.unref?.();
  } catch (err) {
    console.error(`IPE: failed to launch browser (${cmd[0]}): ${err}`);
  }
}
