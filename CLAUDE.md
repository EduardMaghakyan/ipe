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

- **`apps/hook/server/index.ts`** — Binary entrypoint. Reads Claude Code's JSON from stdin, starts an in-process `Bun.serve` on an ephemeral port (or `IPE_PORT` if set), opens the browser, awaits the user's decision via an in-process Promise, writes JSON to stdout, exits.
- **`packages/server/`** — HTTP server (`Bun.serve`), session management, all API routes, SSE broadcasting for the UI, plan version history (`history.ts`), browser launching (`browser.ts`), update checking (`update.ts`).
- **`packages/ui/`** — Svelte 5 frontend. `App.svelte` orchestrates session state and SSE subscriptions. Components in `lib/`, pure utilities in `utils/`.

### Single-process design

Each hook invocation owns its own ephemeral server. There is no shared helper, no lock file, no inter-process coordination. N concurrent hooks → N tabs. SIGINT/SIGTERM resolve the in-flight session as `deny` so stdout is always well-formed.

### Key data flow

stdin JSON → `readStdinWithTimeout()` → `resolveSnippets()` → `Bun.serve()` on ephemeral port → `addSession()` returns Promise → `openBrowser()` (detached, fire-and-forget) → user reviews in Svelte UI → approve/deny POST → `resolveSession()` resolves the Promise → `outputDecision()` writes to stdout → `server.stop()` in finally → exit.

## Tech stack

- **Runtime/bundler:** Bun
- **UI framework:** Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`)
- **Build:** Vite with `vite-plugin-singlefile`
- **Tests:** Bun test (unit/integration), Playwright (e2e)
- **Formatting:** Prettier with `prettier-plugin-svelte`

## Conventions

- Markdown rendering uses `marked` (via `utils/markedRenderer.ts`) with a custom renderer that injects `data-unit-id` attributes for annotation mapping. The renderer produces `{ html, units, title }` where `units` are annotatable semantic elements (headings, paragraphs, list items, code lines, table rows, blockquotes).
- The diff engine in `utils/diff.ts` uses LCS — keep it dependency-free.
- UI state is per-session via a `Map<sessionId, SessionUIState>` with save/restore on tab switching (the UI still supports multiple sessions per server even though hooks now only register one each).
- `IPE_PORT` is a _preferred_ port; if it's already in use the hook falls back to an OS-assigned ephemeral port.
- `IPE_BROWSER` overrides the browser-launch command. `IPE_BROWSER=true` is used in tests to no-op the launch.
- `IPE_STDIN_TIMEOUT_MS` overrides the stdin read deadline (default 30000) — used in tests.
