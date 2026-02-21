#!/usr/bin/env bash
set -euo pipefail

IPE_DIR="$HOME/.ipe"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
REPO_URL="https://github.com/eduardmaghakyan/ipe.git"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}==>${NC} $1"; }
warn()  { echo -e "${YELLOW}==>${NC} $1"; }
error() { echo -e "${RED}==>${NC} $1"; exit 1; }

# Check prerequisites
command -v git >/dev/null 2>&1 || error "git is required but not installed."
command -v bun >/dev/null 2>&1 || error "bun is required but not installed. Install it: https://bun.sh"

# Clone or update
if [ -d "$IPE_DIR" ]; then
  info "Updating existing installation..."
  cd "$IPE_DIR"
  git pull --ff-only
else
  info "Cloning IPE..."
  git clone "$REPO_URL" "$IPE_DIR"
  cd "$IPE_DIR"
fi

# Install dependencies
info "Installing dependencies..."
bun install

# Build UI
info "Building UI..."
cd "$IPE_DIR/packages/ui"
bun run build
cd "$IPE_DIR"

# Register global Claude Code hook
info "Configuring Claude Code hook..."

mkdir -p "$HOME/.claude"

bun -e "
const fs = require('fs');
const path = '$CLAUDE_SETTINGS';
const hookEntry = {
  matcher: 'ExitPlanMode',
  hooks: [{ type: 'command', command: 'bun $IPE_DIR/apps/hook/server/index.ts', timeout: 345600 }]
};

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(path, 'utf-8'));
} catch {}

if (!settings.hooks) settings.hooks = {};
if (!settings.hooks.PermissionRequest) settings.hooks.PermissionRequest = [];

// Remove any existing IPE hook to avoid duplicates
settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter(
  (h) => h.matcher !== 'ExitPlanMode' || !h.hooks?.some((x) => x.command?.includes('.ipe/'))
);

settings.hooks.PermissionRequest.push(hookEntry);
fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
"

info "Done! IPE is installed and configured."
echo ""
echo "  Verify with: claude and run /hooks"
echo "  Uninstall:   rm -rf ~/.ipe"
echo "               (then remove the ExitPlanMode hook from ~/.claude/settings.json)"
