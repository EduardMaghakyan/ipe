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

  const mockFileDiffs = [
    {
      oldPath: "src/auth/login.ts",
      newPath: "src/auth/login.ts",
      status: "modified",
      hunks: [
        {
          header:
            "@@ -10,8 +10,12 @@ import { validateCredentials } from './validate';",
          lines: [
            {
              type: "context",
              content:
                "export async function login(email: string, password: string) {",
              oldLineNo: 10,
              newLineNo: 10,
            },
            {
              type: "context",
              content: "  const user = await findUserByEmail(email);",
              oldLineNo: 11,
              newLineNo: 11,
            },
            {
              type: "context",
              content: "  if (!user) {",
              oldLineNo: 12,
              newLineNo: 12,
            },
            {
              type: "remove",
              content: "    throw new Error('Invalid credentials');",
              oldLineNo: 13,
            },
            {
              type: "add",
              content:
                "    throw new AuthError('INVALID_EMAIL', 'No account found with this email');",
              newLineNo: 13,
            },
            { type: "context", content: "  }", oldLineNo: 14, newLineNo: 14 },
            { type: "context", content: "", oldLineNo: 15, newLineNo: 15 },
            {
              type: "remove",
              content:
                "  const valid = await bcrypt.compare(password, user.passwordHash);",
              oldLineNo: 16,
            },
            {
              type: "add",
              content:
                "  const valid = await validateCredentials(password, user.passwordHash);",
              newLineNo: 16,
            },
            {
              type: "context",
              content: "  if (!valid) {",
              oldLineNo: 17,
              newLineNo: 17,
            },
            {
              type: "remove",
              content: "    throw new Error('Invalid credentials');",
              oldLineNo: 18,
            },
            {
              type: "add",
              content: "    await recordFailedAttempt(user.id);",
              newLineNo: 18,
            },
            {
              type: "add",
              content:
                "    throw new AuthError('INVALID_PASSWORD', 'Incorrect password');",
              newLineNo: 19,
            },
            { type: "context", content: "  }", oldLineNo: 19, newLineNo: 20 },
            { type: "add", content: "", newLineNo: 21 },
            {
              type: "add",
              content: "  await resetFailedAttempts(user.id);",
              newLineNo: 22,
            },
            {
              type: "context",
              content: "  return createSession(user);",
              oldLineNo: 20,
              newLineNo: 23,
            },
            { type: "context", content: "}", oldLineNo: 21, newLineNo: 24 },
          ],
        },
      ],
    },
    {
      oldPath: "src/auth/errors.ts",
      newPath: "src/auth/errors.ts",
      status: "added",
      hunks: [
        {
          header: "@@ -0,0 +1,18 @@",
          lines: [
            {
              type: "add",
              content: "export class AuthError extends Error {",
              newLineNo: 1,
            },
            { type: "add", content: "  code: string;", newLineNo: 2 },
            { type: "add", content: "", newLineNo: 3 },
            {
              type: "add",
              content: "  constructor(code: string, message: string) {",
              newLineNo: 4,
            },
            { type: "add", content: "    super(message);", newLineNo: 5 },
            { type: "add", content: "    this.code = code;", newLineNo: 6 },
            {
              type: "add",
              content: "    this.name = 'AuthError';",
              newLineNo: 7,
            },
            { type: "add", content: "  }", newLineNo: 8 },
            { type: "add", content: "}", newLineNo: 9 },
            { type: "add", content: "", newLineNo: 10 },
            {
              type: "add",
              content: "export class RateLimitError extends AuthError {",
              newLineNo: 11,
            },
            { type: "add", content: "  retryAfter: number;", newLineNo: 12 },
            { type: "add", content: "", newLineNo: 13 },
            {
              type: "add",
              content: "  constructor(retryAfter: number) {",
              newLineNo: 14,
            },
            {
              type: "add",
              content:
                "    super('RATE_LIMITED', `Too many attempts. Try again in ${retryAfter}s`);",
              newLineNo: 15,
            },
            {
              type: "add",
              content: "    this.retryAfter = retryAfter;",
              newLineNo: 16,
            },
            { type: "add", content: "  }", newLineNo: 17 },
            { type: "add", content: "}", newLineNo: 18 },
          ],
        },
      ],
    },
    {
      oldPath: "src/utils/helpers.ts",
      newPath: "src/utils/helpers.ts",
      status: "modified",
      hunks: [
        {
          header:
            "@@ -42,6 +42,15 @@ export function formatDate(date: Date): string {",
          lines: [
            {
              type: "context",
              content: "  return date.toISOString().split('T')[0];",
              oldLineNo: 42,
              newLineNo: 42,
            },
            { type: "context", content: "}", oldLineNo: 43, newLineNo: 43 },
            { type: "context", content: "", oldLineNo: 44, newLineNo: 44 },
            {
              type: "add",
              content:
                "export async function recordFailedAttempt(userId: string): Promise<void> {",
              newLineNo: 45,
            },
            {
              type: "add",
              content: "  const key = `failed:${userId}`;",
              newLineNo: 46,
            },
            {
              type: "add",
              content: "  const count = (await redis.incr(key)) || 0;",
              newLineNo: 47,
            },
            {
              type: "add",
              content: "  await redis.expire(key, 900); // 15 min window",
              newLineNo: 48,
            },
            { type: "add", content: "  if (count >= 5) {", newLineNo: 49 },
            {
              type: "add",
              content: "    throw new RateLimitError(900);",
              newLineNo: 50,
            },
            { type: "add", content: "  }", newLineNo: 51 },
            { type: "add", content: "}", newLineNo: 52 },
            { type: "add", content: "", newLineNo: 53 },
            {
              type: "context",
              content: "export function slugify(text: string): string {",
              oldLineNo: 45,
              newLineNo: 54,
            },
          ],
        },
      ],
    },
    {
      oldPath: "src/legacy/old-auth.ts",
      newPath: "src/legacy/old-auth.ts",
      status: "deleted",
      hunks: [
        {
          header: "@@ -1,8 +0,0 @@",
          lines: [
            {
              type: "remove",
              content:
                "// Legacy authentication — replaced by src/auth/login.ts",
              oldLineNo: 1,
            },
            {
              type: "remove",
              content:
                "export function legacyLogin(user: string, pass: string) {",
              oldLineNo: 2,
            },
            {
              type: "remove",
              content: "  // This was the old login flow",
              oldLineNo: 3,
            },
            {
              type: "remove",
              content: "  return { token: 'legacy-token' };",
              oldLineNo: 4,
            },
            { type: "remove", content: "}", oldLineNo: 5 },
          ],
        },
      ],
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
              .replace("## Testing", "## Verification")
              .replace(
                "> **Important:** All existing endpoints must continue to work during the migration period. We'll support both session and JWT auth temporarily.\n\n",
                "",
              )
              .replace('expiresIn: "15m"', 'expiresIn: "30m"'),
            timestamp: Date.now() - 600000,
          },
          {
            version: 2,
            plan: p
              .replace("## Testing", "## Verification")
              .replace('expiresIn: "15m"', 'expiresIn: "15m"'),
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
      {
        sessionId: "session-diff-review",
        title: "Diff Review",
        plan: "",
        permissionMode: "review",
        fileSnippets: [],
        previousPlans: [],
        mode: "diff-review",
        fileDiffs: mockFileDiffs,
        registeredAt: Date.now() - 10000,
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
              version: "v0.2.0",
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
