# Refactor Authentication System

## Context

The current authentication uses session-based cookies which don't scale well across microservices. We need to migrate to JWT-based auth with refresh tokens.

## Step 1: Create JWT utilities

Add a new `auth/jwt.ts` module with helper functions:

```typescript
import { sign, verify } from "jsonwebtoken";

export function createAccessToken(userId: string): string {
  return sign({ sub: userId }, process.env.JWT_SECRET!, {
    expiresIn: "15m",
  });
}

export function createRefreshToken(userId: string): string {
  return sign({ sub: userId, type: "refresh" }, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  });
}
```

Here's the diff for the middleware changes:

```diff
@@ -1,8 +1,12 @@
-import session from 'express-session';
+import { verifyToken } from './auth/jwt';

 export function authMiddleware(req, res, next) {
-  if (!req.session.userId) {
-    return res.status(401).json({ error: 'Not authenticated' });
+  const header = req.headers.authorization;
+  if (!header?.startsWith('Bearer ')) {
+    return res.status(401).json({ error: 'Missing token' });
   }
-  next();
+  const token = header.slice(7);
+  const decoded = verifyToken(token);
+  req.user = decoded;
+  next();
 }
```

## Step 2: Update middleware

Replace the existing session middleware with JWT verification:

- Extract token from `Authorization: Bearer <token>` header
- Verify signature and expiration
- Attach decoded user to `req.user`
- Return 401 for invalid/expired tokens

## Step 3: Database changes

Add a `refresh_tokens` table:

| Column     | Type      | Description          |
| ---------- | --------- | -------------------- |
| id         | UUID      | Primary key          |
| user_id    | UUID      | Foreign key to users |
| token_hash | VARCHAR   | Hashed refresh token |
| expires_at | TIMESTAMP | Expiration time      |
| created_at | TIMESTAMP | Creation time        |

## Step 4: Update API endpoints

> **Important:** All existing endpoints must continue to work during the migration period. We'll support both session and JWT auth temporarily.

The following endpoints need updates:

- `POST /api/auth/login` — return access + refresh tokens
- `POST /api/auth/refresh` — exchange refresh token for new access token
- `POST /api/auth/logout` — invalidate refresh token
- `GET /api/auth/me` — verify JWT instead of session

## Step 5: Frontend changes

1. Store access token in memory (not localStorage)
2. Store refresh token in httpOnly cookie
3. Add axios interceptor for automatic token refresh on 401
4. Update all API calls to include `Authorization` header

## Testing

- Unit tests for JWT creation/verification
- Integration tests for login/refresh/logout flow
- E2E tests for token expiration and auto-refresh
