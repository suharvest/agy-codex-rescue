#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_SOURCE="$SCRIPT_DIR/bin/codex-rescue"
SKILL_SOURCE="$SCRIPT_DIR/skills/codex-rescue"

echo "=================================================="
echo " 🛡️  Installing agy-codex-rescue"
echo "=================================================="

# Ensure bin script is executable
chmod +x "$BIN_SOURCE"

# 1. Determine target binary directory
if [[ -n "${PREFIX:-}" && -d "$PREFIX/bin" ]]; then
  TARGET_BIN_DIR="$PREFIX/bin"
elif [[ -d "$HOME/.local/bin" ]]; then
  TARGET_BIN_DIR="$HOME/.local/bin"
else
  TARGET_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$TARGET_BIN_DIR"
fi

TARGET_BIN="$TARGET_BIN_DIR/codex-rescue"

# Create symlink for binary
if [[ -L "$TARGET_BIN" || -f "$TARGET_BIN" ]]; then
  rm -f "$TARGET_BIN"
fi
ln -s "$BIN_SOURCE" "$TARGET_BIN"
echo "✅ Linked CLI executable: $TARGET_BIN -> $BIN_SOURCE"

# Verify PATH
if [[ ":$PATH:" != *":$TARGET_BIN_DIR:"* ]]; then
  echo "⚠️  Notice: $TARGET_BIN_DIR is not currently in your PATH."
  echo "   Add it with: export PATH=\"$TARGET_BIN_DIR:\$PATH\""
fi

# 2. Link Antigravity and Agent skills if target directories exist
SKILL_TARGET_BASES=(
  "$HOME/.gemini/antigravity-cli/skills"
  "$HOME/.gemini/config/skills"
  "$HOME/.claude/skills"
)

for SKILL_BASE in "${SKILL_TARGET_BASES[@]}"; do
  PARENT_DIR="$(dirname "$SKILL_BASE")"
  if [[ -d "$PARENT_DIR" ]]; then
    mkdir -p "$SKILL_BASE"
    TARGET_SKILL="$SKILL_BASE/codex-rescue"
    if [[ -L "$TARGET_SKILL" || -d "$TARGET_SKILL" ]]; then
      rm -rf "$TARGET_SKILL"
    fi
    ln -s "$SKILL_SOURCE" "$TARGET_SKILL"
    echo "✅ Linked skill: $TARGET_SKILL -> $SKILL_SOURCE"
  fi
done

# 3. Validate installation
echo ""
echo "🔍 Validating installation..."
"$TARGET_BIN" --version
echo ""
"$TARGET_BIN" setup

echo ""
echo "🎉 Installation completed successfully!"
