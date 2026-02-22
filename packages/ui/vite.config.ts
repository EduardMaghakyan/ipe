import { readFileSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

function mockApiPlugin() {
  return {
    name: "mock-api",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use((req: any, res: any, next: Function) => {
        if (req.url === "/api/plan" && req.method === "GET") {
          const plan = readFileSync(
            resolve(__dirname, "src/mock-plan.md"),
            "utf-8",
          );
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({ plan, permissionMode: "plan", version: "dev" }),
          );
          return;
        }

        if (req.url === "/api/history" && req.method === "GET") {
          const plan = readFileSync(
            resolve(__dirname, "src/mock-plan.md"),
            "utf-8",
          );
          const mockHistory = [
            {
              version: 1,
              plan: plan
                .replace(
                  "## Step 5: Frontend changes",
                  "## Step 5: Client updates",
                )
                .replace("## Testing", "## Verification"),
              timestamp: Date.now() - 120000,
            },
            {
              version: 2,
              plan: plan.replace(
                "## Step 5: Frontend changes",
                "## Step 5: Client updates",
              ),
              timestamp: Date.now() - 60000,
            },
          ];
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(mockHistory));
          return;
        }

        if (req.url === "/api/approve" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            const { feedback } = JSON.parse(body || "{}");
            console.log("\n✅ Plan approved");
            if (feedback) console.log("Feedback:\n" + feedback);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }

        if (req.url === "/api/deny" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            const { feedback } = JSON.parse(body || "{}");
            console.log("\n❌ Changes requested");
            if (feedback) console.log("Feedback:\n" + feedback);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), viteSingleFile(), mockApiPlugin()],
  build: {
    outDir: "dist",
  },
});
