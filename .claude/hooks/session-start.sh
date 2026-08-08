#!/bin/bash
set -euo pipefail

# Only needed on Claude Code on the web — local machines manage their own deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
corepack enable >/dev/null 2>&1 || true
pnpm install
