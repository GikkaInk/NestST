#!/usr/bin/env bash
# Запускает собранный редактор M1, через 10 с печатает RSS_MB (по дереву процессов).
# У редактора нет сигнала READY, поэтому время запуска не измеряется (STARTUP_MS n/a).
set -u
BIN="$(cd "$(dirname "$0")/.." && pwd)/apps/editor/src-tauri/target/release/nestst_editor"
OUT="$(mktemp)"

if [ ! -x "$BIN" ]; then
  echo "binary not found: $BIN (run: pnpm -F @nestst/editor tauri build --no-bundle)" >&2
  exit 2
fi

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

if ! kill -0 "$PID" 2>/dev/null; then
  echo "editor exited early; output:" >&2
  cat "$OUT" >&2
  exit 1
fi

RSS_KB=0
NPROC=0
for p in $(tree_pids "$PID"); do
  kb=$(ps -o rss= -p "$p" 2>/dev/null | tr -d ' ')
  RSS_KB=$((RSS_KB + ${kb:-0}))
  NPROC=$((NPROC + 1))
done

echo "RSS_MB $((RSS_KB / 1024))"
echo "PROCESSES $NPROC"
echo "STARTUP_MS n/a (editor has no READY signal; RSS taken 10 s after launch, start screen)"
