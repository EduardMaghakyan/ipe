import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "bun run dev -- --port 5174",
    cwd: "packages/ui",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
