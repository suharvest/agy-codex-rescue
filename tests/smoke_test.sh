#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=================================================="
echo " 🧪 Running agy-codex-rescue Test Suite"
echo "=================================================="

# 1. Run offline unit/functional test suite
echo ""
echo "▶ Running offline unit test suite (node:test)..."
node "$SCRIPT_DIR/test_offline.mjs"

# 2. Test setup command
echo ""
echo "▶ Testing CLI setup command..."
"$PROJECT_ROOT/bin/codex-rescue" setup

# 3. Test list command
echo ""
echo "▶ Testing CLI list command..."
"$PROJECT_ROOT/bin/codex-rescue" list

# 4. Live test with Codex if available and authenticated
if which codex >/dev/null 2>&1; then
  LOGIN_STATUS="$(codex login status 2>&1 || true)"
  if [[ "$LOGIN_STATUS" == *"Logged in"* ]]; then
    echo ""
    echo "▶ Codex is installed and authenticated. Running live read-only task..."
    TMP_WS="$(mktemp -d)"
    trap 'rm -rf "$TMP_WS"' EXIT
    git -C "$TMP_WS" init -b main >/dev/null 2>&1 || git -C "$TMP_WS" init >/dev/null 2>&1
    echo "# Test Workspace" > "$TMP_WS/README.md"
    git -C "$TMP_WS" add README.md >/dev/null 2>&1
    git -C "$TMP_WS" -c user.name="Tester" -c user.email="test@example.com" commit -m "initial commit" >/dev/null 2>&1 || true

    echo "Running live task test in $TMP_WS..."
    LIVE_OUT="$("$PROJECT_ROOT/bin/codex-rescue" task "Reply with the single word RESCUE_ONLINE" --dir "$TMP_WS")"
    echo "$LIVE_OUT"

    echo ""
    echo "▶ Testing job status inspection for recent job..."
    "$PROJECT_ROOT/bin/codex-rescue" status --dir "$TMP_WS"

    echo ""
    echo "✅ Live task test completed successfully!"
  else
    echo "ℹ️  Codex is not logged in; skipping live task execution."
  fi
else
  echo "ℹ️  Codex executable not found; skipping live task execution."
fi

echo ""
echo "=================================================="
echo " 🎉 All tests passed successfully!"
echo "=================================================="
