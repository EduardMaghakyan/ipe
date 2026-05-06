# IPE

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/EduardMaghakyan/ipe)](https://github.com/EduardMaghakyan/ipe/releases)

Review Claude Code plans and code diffs in a browser UI with inline comments, like a GitHub PR review.

![demo](https://github.com/user-attachments/assets/096b1f86-eba8-4b66-b99e-2808fea4e00f)

## Features

- **GitHub-style plan review** — inline comments on any block or text selection, approve or request changes
- **File snippet preview** — click any backtick-wrapped file reference (e.g. `` `src/index.ts` ``) to open a resizable side drawer with syntax-highlighted source code
- **Plan version diff** — compare current plan against previous versions with side-by-side or inline views
- **Concurrent sessions** — each plan opens in its own browser tab; multiple Claude Code sessions can be reviewed in parallel
- **Line-range file references** — supports `src/foo.ts:10-20` syntax to show specific line ranges in the snippet drawer
- **Code diff review** — review unstaged/staged/all changes with a file picker, unified diff view, and inline commenting (`/diff-review`)

## Install

### macOS / Linux

```sh
curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.ps1 | iex
```

This downloads a prebuilt binary, registers it as a Claude Code hook, and installs the `/diff-review` command. Run it again to update.

To pin a specific version:

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash -s -- --version v0.1.0

# Windows (PowerShell)
$env:IPE_VERSION="v0.1.0"; irm https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.ps1 | iex
```

**Supported platforms:** macOS (arm64, x64), Linux (x64), Windows (x64).

### Manual Setup

Download the binary for your platform from [Releases](https://github.com/eduardmaghakyan/ipe/releases):

| Platform    | Binary                |
| ----------- | --------------------- |
| macOS arm64 | `ipe-darwin-arm64`    |
| macOS x64   | `ipe-darwin-x64`      |
| Linux x64   | `ipe-linux-x64`       |
| Windows x64 | `ipe-windows-x64.exe` |

**macOS / Linux:**

```sh
mkdir -p ~/.ipe
curl -fSL https://github.com/eduardmaghakyan/ipe/releases/latest/download/ipe-darwin-arm64 -o ~/.ipe/ipe
chmod +x ~/.ipe/ipe
```

**Windows (PowerShell):**

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.ipe" | Out-Null
Invoke-WebRequest -Uri "https://github.com/eduardmaghakyan/ipe/releases/latest/download/ipe-windows-x64.exe" -OutFile "$env:USERPROFILE\.ipe\ipe.exe"
```

Then add the hook to your Claude Code settings (`~/.claude/settings.json` for global, `.claude/settings.json` for project-level, or `.claude/settings.local.json` for local-only):

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          {
            "type": "command",
            "command": "~/.ipe/ipe",
            "timeout": 345600
          }
        ]
      }
    ]
  }
}
```

On Windows, use the full path: `"command": "C:\\Users\\<you>\\.ipe\\ipe.exe"`

To also enable the `/diff-review` slash command, create `~/.claude/commands/diff-review.md` — see `install.sh` for the template.

**Key details:**

- `"matcher": "ExitPlanMode"` — the hook only fires when Claude calls `ExitPlanMode`, not on other permission requests.
- `"timeout": 345600` — 4 days in seconds. Generous window for reviewing plans. The process blocks until you approve or deny.
- Verify your hook is registered by running `/hooks` inside Claude Code.

## Usage

1. Work with Claude Code normally. When Claude generates a plan and calls `ExitPlanMode`, IPE intercepts the request.
2. A browser tab opens automatically showing the plan.
3. **Add comments:** Select any text → click "Add Comment", or hover a block and click the "+" button in the left gutter.
4. **General feedback:** Use the text area at the bottom of the plan for comments not tied to a specific block.
5. **Accept:** Click the green "Accept" button. Claude proceeds with the plan.
6. **Request Changes:** Click the amber "Request Changes" button. Your inline comments and general feedback are sent back to Claude.
7. The browser tab closes automatically after submitting.

## Diff Review

Review code changes interactively before committing:

1. Run `/diff-review` in Claude Code (or `~/.ipe/ipe diff-review` directly).
2. A browser tab opens showing changed files with a unified diff view.
3. Click files in the left sidebar to navigate between them.
4. Add inline comments on any diff line using the "+" gutter button.
5. **Approve** or **Request Changes** — feedback is sent back to Claude.

Options: `--staged` (staged changes only), `--all` (all changes vs HEAD).

## Configuration

| Variable      | Description                                                         | Default          |
| ------------- | ------------------------------------------------------------------- | ---------------- |
| `IPE_BROWSER` | Browser executable plus optional flags, space-separated (e.g. `firefox`, `firefox --new-window`). No shell expansion — paths containing spaces are not supported. | Platform default |
| `IPE_PORT`    | Preferred port; falls back to an OS-assigned ephemeral port if busy | OS-assigned      |

Platform defaults: `open` (macOS), `xdg-open` (Linux), `cmd /c start` (Windows).

The UI supports light and dark themes — toggle with the sun/moon button in the toolbar. Your preference is saved across sessions.

## Development

Requires [Bun](https://bun.sh) for development.

**Dev preview** — run the UI with Vite dev server and mock API (HMR, no hook server needed):

```sh
cd packages/ui && bun run dev
```

Opens at `http://localhost:5173` with a sample plan. Approve/Deny actions log to the terminal.

**Build** — compile the standalone binary:

```sh
bun run build
```

Produces `./ipe` — a self-contained executable that embeds the Bun runtime and the built UI.

**Manual testing** — pipe a fake plan into the binary:

```sh
printf '{"tool_input":{"plan":"# Test Plan\\n\\n## Step 1\\nDo something"},"permission_mode":"default"}' | ./ipe
```

**Tests:**

```sh
bun run test       # unit + integration tests
bun run test:e2e   # Playwright browser tests
bun run test:all   # everything
```

**Formatting:**

```sh
bun run format        # auto-fix
bun run format:check  # check only
```

## Uninstall

**macOS / Linux:**

```sh
rm -rf ~/.ipe
rm -f ~/.claude/commands/diff-review.md
```

**Windows (PowerShell):**

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.ipe"
Remove-Item -Force "$env:USERPROFILE\.claude\commands\diff-review.md" -ErrorAction SilentlyContinue
```

Then remove the `ExitPlanMode` hook entry from `~/.claude/settings.json`.
