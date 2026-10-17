#!/usr/bin/env bash
# Запускает собранное приложение M0, через 10 с печатает STARTUP_MS и RSS_MB (по дереву процессов).
set -u
BIN="$(cd "$(dirname "$0")/.." && pwd)/prototypes/m0/src-tauri/target/release/m0"
OUT="$(mktemp)"

tree_pids() {
  local p
  echo "$1"
  for p in $(ps -o pid= --ppid "$1"); do tree_pids "$p"; done
}

PID=""
cleanup() {
  if [ -n "$PID" ]; then
    local pids
    pids=$(tree_pids "$PID" 2>/dev/null)
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null
    wait "$PID" 2>/dev/null
  fi
  rm -f "$OUT"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

"$BIN" >"$OUT" 2>&1 &
PID=$!
sleep 10

RSS_KB=0
for p in $(tree_pids "$PID"); do
  kb=$(ps -o rss= -p "$p" 2>/dev/null | tr -d ' ')
  RSS_KB=$((RSS_KB + ${kb:-0}))
done

STARTUP=$(awk '/^READY /{print $2; exit}' "$OUT")
echo "RSS_MB $((RSS_KB / 1024))"
if [ -z "$STARTUP" ]; then
  echo "STARTUP_MS n/a"
  exit 1
fi
echo "STARTUP_MS $STARTUP"
