#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_SOURCE="$SCRIPT_DIR/bin/codex-rescue"
SKILL_SOURCE="$SCRIPT_DIR/skills/codex-rescue"

echo "=================================================="
echo " 🗑️  Uninstalling agy-codex-rescue"
echo "=================================================="

# 1. Remove binary symlinks
CANDIDATE_BINS=(
  "${PREFIX:-}/bin/codex-rescue"
  "$HOME/.local/bin/codex-rescue"
  "/usr/local/bin/codex-rescue"
)

for TARGET_BIN in "${CANDIDATE_BINS[@]}"; do
  if [[ -n "$TARGET_BIN" && -L "$TARGET_BIN" ]]; then
    LINK_DEST="$(readlink -f "$TARGET_BIN" 2>/dev/null || true)"
    if [[ "$LINK_DEST" == "$BIN_SOURCE" || "$LINK_DEST" == *"/agy-codex-rescue/bin/codex-rescue" ]]; then
      rm -f "$TARGET_BIN"
      echo "✅ Removed binary link: $TARGET_BIN"
    fi
  fi
done

# 2. Remove skill symlinks
SKILL_TARGET_BASES=(
  "$HOME/.gemini/antigravity-cli/skills/codex-rescue"
  "$HOME/.gemini/config/skills/codex-rescue"
  "$HOME/.claude/skills/codex-rescue"
)

for TARGET_SKILL in "${SKILL_TARGET_BASES[@]}"; do
  if [[ -L "$TARGET_SKILL" ]]; then
    LINK_DEST="$(readlink -f "$TARGET_SKILL" 2>/dev/null || true)"
    if [[ "$LINK_DEST" == "$SKILL_SOURCE" || "$LINK_DEST" == *"/agy-codex-rescue/skills/codex-rescue" ]]; then
      rm -rf "$TARGET_SKILL"
      echo "✅ Removed skill link: $TARGET_SKILL"
    fi
  fi
done

echo ""
echo "🎉 agy-codex-rescue uninstalled cleanly."
