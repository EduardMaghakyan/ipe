import { readFileSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

function mockApiPlugin() {
  const plan = () =>
    readFileSync(resolve(__dirname, "src/mock-plan.md"), "utf-8");

  const darkModePlan = `# Add Dark Mode Support

## Context

Users have requested a dark mode option. We need to implement a theme system that respects system preferences and allows manual toggling.

## Step 1: Create theme CSS variables

Define light and dark color palettes using CSS custom properties:

\`\`\`css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border-color: #e0e0e0;
}

[data-theme="dark"] {
  --bg-primary: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0a0;
  --border-color: #404040;
}
\`\`\`

## Step 2: Add theme toggle component

Create a \`ThemeToggle.svelte\` component with system/light/dark options:

- Read initial preference from \`localStorage\` or \`prefers-color-scheme\`
- Toggle sets \`data-theme\` attribute on \`<html>\`
- Persist selection to \`localStorage\`

## Step 3: Update all components

Replace hardcoded colors with CSS variables across all components. Key files:

- \`App.svelte\` — main background and text
- \`Toolbar.svelte\` — header bar colors
- \`PlanViewer.svelte\` — code block and diff colors
`;

  const dbPoolPlan = `# Fix Database Connection Pooling

## Context

Production is hitting connection limits during peak traffic. The current implementation creates a new connection per request instead of using a pool.

## Step 1: Configure connection pool

Replace direct connections with a pool manager:

\`\`\`typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
\`\`\`

## Step 2: Update query helpers

Modify the query wrapper to use pool connections:

\`\`\`diff
@@ -1,9 +1,8 @@
-import { Client } from 'pg';
+import { pool } from './pool';

 export async function query(sql: string, params?: any[]) {
-  const client = new Client();
-  await client.connect();
+  const client = await pool.connect();
   try {
     return await client.query(sql, params);
   } finally {
-    await client.end();
+    client.release();
   }
 }
\`\`\`

## Step 3: Add health monitoring

Add a \`/api/health/db\` endpoint that reports pool statistics:

- Total connections
- Idle connections
- Waiting requests
- Alert if waiting > 5
`;

  const dbPoolPlanV1 = dbPoolPlan
    .replace("## Step 3: Add health monitoring", "## Step 3: Add monitoring")
    .replace("max: 20,", "max: 10,");

  const mockFileSnippets = [
    {
      path: "auth/jwt.ts",
      content: `import { sign, verify, decode, type JwtPayload, type SignOptions, type VerifyOptions } from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Configuration ──────────────────────────────────────────────────────────────────────────────────────────

interface JWTConfig {
  secret: string;
  issuer: string;
  audience: string;
  accessTokenTTL: number;   // seconds
  refreshTokenTTL: number;  // seconds
  algorithm: "HS256" | "HS384" | "HS512" | "RS256";
}

const DEFAULT_CONFIG: JWTConfig = {
  secret: process.env.JWT_SECRET || "dev-secret-do-not-use-in-production-this-is-a-very-long-secret-key-for-testing-purposes-only",
  issuer: "ipe-auth-service",
  audience: "ipe-client",
  accessTokenTTL: 15 * 60,          // 15 minutes
  refreshTokenTTL: 7 * 24 * 60 * 60, // 7 days
  algorithm: "HS256",
};

let config: JWTConfig = { ...DEFAULT_CONFIG };

export function configureJWT(overrides: Partial<JWTConfig>): void {
  config = { ...config, ...overrides };
  console.log(\`[JWT] Configuration updated: issuer=\${config.issuer}, algorithm=\${config.algorithm}, accessTTL=\${config.accessTokenTTL}s\`);
}

// ─── Token Types ────────────────────────────────────────────────────────────────────────────────────────────

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
}

export interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  type: "refresh";
  family: string;  // token family for rotation detection
  generation: number;
}

// ─── Token Creation ─────────────────────────────────────────────────────────────────────────────────────────

export function createAccessToken(userId: string, email: string, roles: string[] = ["user"], permissions: string[] = []): string {
  const signOptions: SignOptions = {
    expiresIn: config.accessTokenTTL,
    issuer: config.issuer,
    audience: config.audience,
    algorithm: config.algorithm,
    jwtid: randomBytes(16).toString("hex"),
  };

  const payload: Omit<AccessTokenPayload, "iat" | "exp" | "iss" | "aud"> = {
    sub: userId,
    email,
    roles,
    permissions: permissions.length > 0 ? permissions : derivePermissionsFromRoles(roles),
    sessionId: randomBytes(8).toString("hex"),
  };

  return sign(payload, config.secret, signOptions);
}

export function createRefreshToken(userId: string, family?: string, generation: number = 0): string {
  const tokenFamily = family || randomBytes(16).toString("hex");
  const signOptions: SignOptions = {
    expiresIn: config.refreshTokenTTL,
    issuer: config.issuer,
    audience: config.audience,
    algorithm: config.algorithm,
    jwtid: randomBytes(16).toString("hex"),
  };

  return sign({ sub: userId, type: "refresh", family: tokenFamily, generation } satisfies Omit<RefreshTokenPayload, "iat" | "exp" | "iss" | "aud">, config.secret, signOptions);
}

// ─── Token Verification ─────────────────────────────────────────────────────────────────────────────────────

export function verifyAccessToken(token: string): AccessTokenPayload {
  const options: VerifyOptions = { issuer: config.issuer, audience: config.audience, algorithms: [config.algorithm] };
  const payload = verify(token, config.secret, options) as AccessTokenPayload;

  if (!payload.sub || !payload.email) {
    throw new Error("Invalid access token: missing required claims (sub, email)");
  }
  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const options: VerifyOptions = { issuer: config.issuer, audience: config.audience, algorithms: [config.algorithm] };
  const payload = verify(token, config.secret, options) as RefreshTokenPayload;

  if (payload.type !== "refresh") {
    throw new Error("Invalid refresh token: wrong token type");
  }
  return payload;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────

function derivePermissionsFromRoles(roles: string[]): string[] {
  const rolePermissionMap: Record<string, string[]> = {
    user: ["read:own", "write:own"],
    editor: ["read:own", "write:own", "read:all", "write:all"],
    admin: ["read:own", "write:own", "read:all", "write:all", "admin:users", "admin:settings", "admin:billing"],
    superadmin: ["read:own", "write:own", "read:all", "write:all", "admin:users", "admin:settings", "admin:billing", "admin:system"],
  };

  const permissions = new Set<string>();
  for (const role of roles) {
    const perms = rolePermissionMap[role] ?? [];
    for (const p of perms) permissions.add(p);
  }
  return [...permissions];
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function decodeWithoutVerification(token: string): JwtPayload | null {
  return decode(token, { json: true });
}`,
    },
  ];

  const mockSessions = () => {
    const p = plan();
    return [
      {
        sessionId: "session-1",
        title: "Refactor Authentication System",
        plan: p,
        permissionMode: "plan",
        fileSnippets: mockFileSnippets,
        previousPlans: [
          {
            version: 1,
            plan: p
              .replace(
                "## Step 5: Frontend changes",
                "## Step 5: Client updates",
              )
              .replace("## Testing", "## Verification"),
            timestamp: Date.now() - 300000,
          },
        ],
        registeredAt: Date.now() - 180000,
      },
      {
        sessionId: "session-2",
        title: "Add Dark Mode Support",
        plan: darkModePlan,
        permissionMode: "plan",
        fileSnippets: [],
        previousPlans: [],
        registeredAt: Date.now() - 60000,
      },
      {
        sessionId: "session-3",
        title: "Fix Database Connection Pooling",
        plan: dbPoolPlan,
        permissionMode: "default",
        fileSnippets: [],
        previousPlans: [
          {
            version: 1,
            plan: dbPoolPlanV1,
            timestamp: Date.now() - 600000,
          },
        ],
        registeredAt: Date.now() - 30000,
      },
    ];
  };

  // SSE connections for UI events
  const uiConnections: any[] = [];

  return {
    name: "mock-api",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use((req: any, res: any, next: Function) => {
        // List sessions
        if (req.url === "/api/sessions" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(mockSessions()));
          return;
        }

        // Health check
        if (req.url === "/api/health" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              sessions: mockSessions().length,
              version: "dev",
              latestVersion: "v0.2.0",
            }),
          );
          return;
        }

        // Upgrade endpoint
        if (req.url === "/api/upgrade" && req.method === "POST") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        // SSE for UI events
        if (req.url === "/api/events" && req.method === "GET") {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.write(`event: init\ndata: ${JSON.stringify(mockSessions())}\n\n`);
          uiConnections.push(res);
          req.on("close", () => {
            const idx = uiConnections.indexOf(res);
            if (idx >= 0) uiConnections.splice(idx, 1);
          });
          return;
        }

        // Session-specific routes
        const sessionMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/(.+)$/);
        if (sessionMatch) {
          const sessionId = decodeURIComponent(sessionMatch[1]);
          const action = sessionMatch[2];

          if (action === "plan" && req.method === "GET") {
            const s = mockSessions().find((s) => s.sessionId === sessionId);
            if (!s) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "not found" }));
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                plan: s.plan,
                permissionMode: s.permissionMode,
                version: "dev",
              }),
            );
            return;
          }

          if (action === "history" && req.method === "GET") {
            const s = mockSessions().find((s) => s.sessionId === sessionId);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(s?.previousPlans ?? []));
            return;
          }

          if (
            (action === "approve" || action === "deny") &&
            req.method === "POST"
          ) {
            let body = "";
            req.on("data", (chunk: string) => (body += chunk));
            req.on("end", () => {
              const { feedback } = JSON.parse(body || "{}");
              const emoji = action === "approve" ? "✅" : "❌";
              const label =
                action === "approve" ? "Plan approved" : "Changes requested";
              console.log(`\n${emoji} ${label} (session: ${sessionId})`);
              if (feedback) console.log("Feedback:\n" + feedback);

              // Notify SSE clients
              for (const conn of uiConnections) {
                conn.write(
                  `event: session-removed\ndata: ${JSON.stringify({ sessionId })}\n\n`,
                );
              }

              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            });
            return;
          }
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
