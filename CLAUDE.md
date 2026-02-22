# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is IPE

Interactive Plan Editor — a Claude Code hook that intercepts `ExitPlanMode`, opens a browser-based plan review UI (like a GitHub PR review with inline comments), and sends the user's decision back to Claude Code via stdout.

## Commands

```sh
bun install                # install dependencies
bun run build              # build UI then compile self-contained binary → ./ipe
bun run test               # unit + integration tests (bun test tests/unit tests/integration)
bun run test:e2e           # Playwright browser tests (requires chromium)
bun run test:all           # all tests
bun run format             # prettier auto-fix
bun run format:check       # prettier check only
cd packages/ui && bun run dev  # Vite dev server with mock API at localhost:5173
```

Manual test the binary: `printf '{"tool_input":{"plan":"# Test\\n\\nStep 1"},"permission_mode":"default"}' | ./ipe`

## Architecture

Bun monorepo with two workspaces: `packages/*` and `apps/*`.

### Build pipeline

1. `packages/ui` builds with Vite + `vite-plugin-singlefile` → single `index.html` (all JS/CSS inlined)
2. `apps/hook/server/index.ts` is compiled with `bun build --compile` → `./ipe` binary that embeds the HTML via `import html from "../ui/dist/index.html" with { type: "text" }`

### Packages

- **`apps/hook/server/index.ts`** — Binary entrypoint. Reads Claude Code's JSON from stdin, coordinates multi-process locking, either starts the server (owner path) or registers as a client to an existing server, outputs decision JSON to stdout.
- **`packages/server/`** — HTTP server (`Bun.serve`), session management, all API routes, SSE broadcasting, lock file handling (`lock.ts`), plan version history (`history.ts`), browser launching (`browser.ts`), update checking (`update.ts`).
- **`packages/ui/`** — Svelte 5 frontend. `App.svelte` orchestrates session state and SSE subscriptions. Components in `lib/`, pure utilities in `utils/`.

### Multi-session design

A single shared server handles multiple concurrent hook processes. First hook wins the lock file (`~/.ipe/server.lock`), subsequent hooks POST their session to the running server and wait via per-session SSE. The server shuts down 5 seconds after the last session resolves.

### Key data flow

stdin JSON → `readStdin()` → lock check → server owner or client path → `addSession()` returns Promise → browser opens → user reviews in Svelte UI → approve/deny POST → `resolveSession()` → SSE `decision` event → `outputDecision()` writes to stdout → Claude Code reads result.

## Tech stack

- **Runtime/bundler:** Bun
- **UI framework:** Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`)
- **Build:** Vite with `vite-plugin-singlefile`
- **Tests:** Bun test (unit/integration), Playwright (e2e)
- **Formatting:** Prettier with `prettier-plugin-svelte`

## Conventions

- The markdown parser in `utils/parser.ts` is hand-rolled (no external dependency) — extend it rather than replacing it.
- The diff engine in `utils/diff.ts` uses LCS — keep it dependency-free.
- Lock file operations in `packages/server/lock.ts` use atomic rename (write to `.tmp` then `renameSync`).
- UI state is per-session via a `Map<sessionId, SessionUIState>` with save/restore on tab switching.
- The `IPE_LOCK_DIR` env var overrides the lock file directory (used in tests to avoid conflicts).
