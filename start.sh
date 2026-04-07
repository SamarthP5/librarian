#!/usr/bin/env bash
# Librarian — one-command start script
# Usage: ./start.sh
# Requires: Python 3.10+ (py launcher on Windows), Node 18+, ANTHROPIC_API_KEY in .env

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Environment ─────────────────────────────────────────────────────────────
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo ""
  echo "⚠  Created .env — set ANTHROPIC_API_KEY before querying documents."
  echo ""
fi

# ── Python: prefer py launcher (Windows), fall back to python3 ───────────────
if command -v py &>/dev/null; then
  PY="py -3"
elif command -v python3 &>/dev/null; then
  PY="python3"
else
  PY="python"
fi

# ── Backend ──────────────────────────────────────────────────────────────────
echo "→ Setting up backend…"
cd "$ROOT/backend"

if [ ! -d ".venv" ]; then
  $PY -m venv .venv
fi

# Activate (Unix: bin/activate, Windows Git Bash: Scripts/activate)
if [ -f ".venv/Scripts/activate" ]; then
  source .venv/Scripts/activate
else
  source .venv/bin/activate
fi

pip install -q -r requirements.txt

echo "→ Starting FastAPI on http://localhost:8000"
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

# ── Frontend ─────────────────────────────────────────────────────────────────
echo "→ Setting up frontend…"
cd "$ROOT/frontend"
npm install --silent

echo "→ Starting Vite dev server on http://localhost:5173"
npm run dev &
FRONTEND_PID=$!

# ── Cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "→ Shutting down…"
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
}
trap cleanup INT TERM

echo ""
echo "✓ Librarian is running."
echo "  App:      http://localhost:5173"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop."
wait
