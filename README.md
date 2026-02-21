# IPE — Interactive Plan Editor

Review Claude Code plans in a browser UI with inline comments, like a GitHub PR review.

## How It Works

```
Claude Code (ExitPlanMode)
    │  plan JSON via stdin
    ▼
Hook Server (Bun process, blocks until resolved)
    │
    ├── HTTP Server (random port)
    │     GET  /             → single-file UI
    │     GET  /api/plan     → plan data
    │     POST /api/approve  → allow
    │     POST /api/deny     → deny + feedback
    │
    └── Opens browser automatically
          │
          ▼
    Browser UI (Svelte SPA)
    ├── Read the plan with syntax-highlighted code blocks
    ├── Select text → "Add Comment" → write inline feedback
    └── Click "Approve" or "Request Changes"
          │
          ▼
    stdout → hook decision JSON → Claude Code continues
```

## Quick Start

**Prerequisites:** [Bun](https://bun.sh)

```sh
git clone <repo-url> && cd ipe
bun install
cd packages/ui && bun run build
```

The UI build produces a single self-contained `index.html` that gets embedded into the server at runtime — no file serving needed.

## Integration with Claude Code

IPE runs as a [Claude Code hook](https://docs.anthropic.com/en/docs/claude-code/hooks) that intercepts `ExitPlanMode` permission requests. Add the following hook configuration using one of the options below.

The hook config:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          {
            "type": "command",
            "command": "bun /absolute/path/to/ipe/apps/hook/server/index.ts",
            "timeout": 345600
          }
        ]
      }
    ]
  }
}
```

> Replace `/absolute/path/to/ipe` with the actual path where you cloned this repo.

**Where to put it:**

| Option            | File                                          | Scope                                       |
| ----------------- | --------------------------------------------- | ------------------------------------------- |
| **Project-level** | `.claude/settings.json` in your project       | This project only, shared with team via git |
| **Global**        | `~/.claude/settings.json`                     | All projects on your machine                |
| **Local-only**    | `.claude/settings.local.json` in your project | This project only, gitignored               |

**Key details:**

- `"matcher": "ExitPlanMode"` — the hook only fires when Claude calls `ExitPlanMode`, not on other permission requests.
- `"timeout": 345600` — 4 days in seconds. This gives you a generous window to review the plan before the hook times out. The process blocks until you approve or deny.
- Verify your hook is registered by running `/hooks` inside Claude Code.

## Usage

1. Work with Claude Code normally. When Claude generates a plan and calls `ExitPlanMode`, IPE intercepts the request.
2. A browser tab opens automatically showing the plan.
3. **Add comments:** Select any text in the plan → click the "Add Comment" popup → write your feedback.
4. **Approve:** Click the green "Approve" button. Claude proceeds with the plan.
5. **Request Changes:** Click the amber "Request Changes" button. Your inline comments are formatted as structured feedback and sent back to Claude.
6. You can close the browser tab after submitting — the server shuts down automatically.

## Configuration

| Variable      | Description                                                   | Default          |
| ------------- | ------------------------------------------------------------- | ---------------- |
| `IPE_BROWSER` | Command to open the browser (e.g. `firefox`, `google-chrome`) | Platform default |

Platform defaults: `open` (macOS), `xdg-open` (Linux), `cmd /c start` (Windows).

## Project Structure

```
ipe/
├── apps/hook/
│   └── server/index.ts          # Entry point — reads stdin, starts server, outputs decision
├── packages/
│   ├── server/
│   │   ├── index.ts             # Bun HTTP server (serves UI + API)
│   │   └── browser.ts           # Cross-platform browser opener
│   └── ui/
│       ├── src/
│       │   ├── App.svelte       # Root component — plan fetching, approve/deny flow
│       │   ├── lib/
│       │   │   ├── Toolbar.svelte         # Top bar with title + action buttons
│       │   │   ├── PlanViewer.svelte      # Renders plan blocks, handles text selection
│       │   │   ├── SelectionPopup.svelte  # "Add Comment" floating button
│       │   │   └── InlineComment.svelte   # Annotation editor widget
│       │   └── utils/
│       │       ├── parser.ts    # Markdown → Block[] (no external deps)
│       │       └── feedback.ts  # Annotations → feedback string
│       └── dist/index.html      # Built single-file bundle (committed)
├── package.json                 # Bun workspaces root
└── tsconfig.json
```

## Development

**Manual testing** — pipe a fake plan into the hook server:

```sh
echo '{"tool_input":{"plan":"# Test Plan\n\n## Step 1\nDo something\n\n## Step 2\nDo something else"},"permission_mode":"default"}' | bun apps/hook/server/index.ts
```

This should:
- Open a browser tab with the plan rendered
- Let you select text and add inline comments
- Output `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` on approve
- Output `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"..."}}}` on deny

**Rebuild the UI** after making changes to `packages/ui/`:

```sh
cd packages/ui && bun run build
```
